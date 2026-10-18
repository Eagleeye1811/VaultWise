// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title SimpleYieldFarm
 * @notice Experiment 5, Part 1 of the VaultWise project — LP-token yield
 *         farming. A user stakes an LP-like token (LPT) and earns a reward
 *         token (RWD) for every second the LPT stays staked.
 *
 *         Contract set (two Solidity sources, as the experiment sheet asks):
 *
 *             MockERC20.sol        deployed twice: ("LP Token", "LPT") and
 *                                  ("Reward Token", "RWD")
 *             SimpleYieldFarm.sol  deployed once with (LPT, RWD)
 *
 *         `MockERC20.sol` is the generic test token in `contracts/experiment4/`,
 *         reused unchanged — it is a plain ERC-20 and has no AMM logic in it.
 *
 * @dev Reward model
 *      ------------
 *      The sheet's introductory, per-user model:
 *
 *          Reward = Staked Amount x Reward Rate x Elapsed Time
 *
 *      with Reward Rate = 0.001 RWD per LPT per second, so 100 LPT staked for
 *      60 s earns 100 x 0.001 x 60 = 6 RWD.
 *
 *      Units and integer precision
 *      ---------------------------
 *      Solidity has no fractions, so 0.001 is stored as an integer scaled by
 *      the token's 18 decimals:
 *
 *          rewardRate       = 1e15   RWD base units per WHOLE LPT per second
 *                                    (1e15 / 1e18 = 0.001 RWD)
 *          REWARD_PRECISION = 1e18   LPT base units in one whole LPT
 *
 *          accrued = stakedBalance * rewardRate * elapsedSeconds / REWARD_PRECISION
 *
 *      where `stakedBalance` is in LPT base units and `accrued` is in RWD base
 *      units. Check: 100e18 * 1e15 * 60 / 1e18 = 6e18 base units = 6 RWD,
 *      exactly. Both tokens must have 18 decimals for "per LPT" and "RWD" to
 *      mean whole tokens; the constructor enforces this.
 *
 *      Multiplication happens before division, and the division rounds DOWN
 *      (towards the farm). Each checkpoint therefore loses strictly less than
 *      one RWD base unit (1e-18 RWD) — and only when `staked * rate * elapsed`
 *      is not a multiple of 1e18, which never happens for whole-token stakes.
 *      No overflow is reachable in practice: even 1e30 LPT base units staked
 *      for 100 years stays below 2^256.
 *
 *      Reward accounting
 *      -----------------
 *      `pendingReward[user]` holds rewards already accrued but not yet paid;
 *      `lastUpdate[user]` is the time up to which they were accrued. Every
 *      function that changes a stake or pays a reward first runs
 *      `_updateReward`, which moves everything earned so far into
 *      `pendingReward` and resets `lastUpdate` to now. So:
 *
 *          - an additional stake never re-prices earlier time at the new size;
 *          - a partial withdrawal never forfeits what was earned before it;
 *          - `earned(user) = pendingReward[user] + (accrual since lastUpdate)`.
 *
 *      Reward funding
 *      --------------
 *      The farm does not mint RWD. It pays only from the RWD it holds, which
 *      the RWD owner mints (or anyone transfers) directly to this address. A
 *      payout larger than that balance reverts with `InsufficientRewardFunding`
 *      and leaves the reward pending, so nobody can be paid more than the farm
 *      can fund and nothing is silently lost. `withdraw()` never touches RWD,
 *      so staked LPT can always be recovered even if the farm runs dry.
 *      Payouts are first come, first served: the farm does not reserve
 *      funding per user.
 *
 *      Safety measures
 *      ---------------
 *      - `SafeERC20` for every token transfer.
 *      - `nonReentrant` (transient-storage variant, EIP-1153) on every
 *        state-changing function.
 *      - Checks -> effects -> interactions: validation first, then stakes and
 *        rewards are written, then tokens move. A failing transfer reverts the
 *        whole transaction, including the state already written.
 *      - Explicit balance / allowance / stake / funding checks with custom
 *        errors, so Remix and the UI show the actual numbers.
 *      - Staking and reward tokens must differ, so staked LPT can never be paid
 *        out as a "reward".
 *      - Fee-on-transfer staking tokens are rejected: `stake()` checks the
 *        farm received exactly `amount` and reverts otherwise.
 *
 *      Educational contract for a local chain or Sepolia. The 0.001 RWD/s rate
 *      is deliberately fast for classroom observation. Not production-ready —
 *      never use it with real funds.
 */
contract SimpleYieldFarm is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Reward rate: RWD base units paid per WHOLE staked LPT per second.
    ///         1e15 = 0.001 RWD (18 decimals). Named as in the experiment sheet.
    uint256 public constant rewardRate = 1e15;

    /// @notice LPT base units in one whole LPT (18 decimals) — the divisor
    ///         that turns `staked * rewardRate * seconds` into RWD base units.
    uint256 public constant REWARD_PRECISION = 1e18;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The LP-like token being staked (LPT).
    IERC20 public immutable stakingToken;

    /// @notice The token paid as farming reward (RWD).
    IERC20 public immutable rewardToken;

    /// @notice LPT currently staked by each user, in base units.
    mapping(address => uint256) public stakedBalance;

    /// @notice Timestamp up to which each user's reward has been accrued.
    mapping(address => uint256) public lastUpdate;

    /// @notice Rewards accrued but not yet harvested, in RWD base units.
    mapping(address => uint256) public pendingReward;

    /// @notice Sum of every user's `stakedBalance`.
    uint256 public totalStaked;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice `user` staked `amount` LPT.
    event Staked(address indexed user, uint256 amount);

    /// @notice `user` received `reward` RWD.
    event RewardPaid(address indexed user, uint256 reward);

    /// @notice `user` withdrew `amount` staked LPT.
    event Withdrawn(address indexed user, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice A token address passed to the constructor was the zero address.
    error ZeroAddress();

    /// @notice The staking token and the reward token were the same address.
    error IdenticalTokens();

    /// @notice A token address passed to the constructor has no contract code.
    error NotAContract(address account);

    /// @notice A token does not use the 18 decimals the reward rate assumes.
    error UnsupportedDecimals(address token, uint8 decimals);

    /// @notice An amount argument was zero.
    error ZeroAmount();

    /// @notice The caller holds less LPT than they tried to stake.
    error InsufficientBalance(uint256 available, uint256 required);

    /// @notice The caller has not approved the farm for enough LPT.
    error InsufficientAllowance(uint256 allowed, uint256 required);

    /// @notice The caller tried to withdraw more LPT than they have staked.
    error InsufficientStakedBalance(uint256 staked, uint256 requested);

    /// @notice The farm holds less RWD than the reward it must pay.
    error InsufficientRewardFunding(uint256 available, uint256 required);

    /// @notice `harvest()` was called with no reward accrued.
    error NoRewardToHarvest();

    /// @notice `exit()` was called with neither a stake nor a pending reward.
    error NothingToExit();

    /// @notice The farm received a different LPT amount than was sent
    ///         (a fee-on-transfer or otherwise non-standard token).
    error TransferAmountMismatch(uint256 expected, uint256 received);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @notice Create the farm for one staking/reward token pair.
     * @param _stakingToken Address of the LP-like token (MockERC20 "LPT").
     * @param _rewardToken  Address of the reward token (MockERC20 "RWD").
     */
    constructor(address _stakingToken, address _rewardToken) {
        if (_stakingToken == address(0) || _rewardToken == address(0)) revert ZeroAddress();
        if (_stakingToken == _rewardToken) revert IdenticalTokens();
        if (_stakingToken.code.length == 0) revert NotAContract(_stakingToken);
        if (_rewardToken.code.length == 0) revert NotAContract(_rewardToken);
        _requireDecimals18(_stakingToken);
        _requireDecimals18(_rewardToken);

        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    // ---------------------------------------------------------------------
    // Farming
    // ---------------------------------------------------------------------

    /**
     * @notice Stake `amount` LPT. Approve the farm for at least `amount` first.
     * @param amount LPT to stake, in base units (100 LPT = 100 * 10**18).
     */
    function stake(uint256 amount) external nonReentrant {
        // ---- checks ----
        if (amount == 0) revert ZeroAmount();
        uint256 available = stakingToken.balanceOf(msg.sender);
        if (available < amount) revert InsufficientBalance(available, amount);
        uint256 allowed = stakingToken.allowance(msg.sender, address(this));
        if (allowed < amount) revert InsufficientAllowance(allowed, amount);

        // ---- effects ----
        // Accrue at the OLD stake size before it changes.
        _updateReward(msg.sender);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        // ---- interactions ----
        uint256 before = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - before;
        // Reverting here also undoes the stake recorded above.
        if (received != amount) revert TransferAmountMismatch(amount, received);

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Pay the caller every RWD accrued so far.
     * @dev Reverts with `NoRewardToHarvest` when nothing has accrued, and with
     *      `InsufficientRewardFunding` when the farm cannot cover it — in which
     *      case the reward stays pending.
     */
    function harvest() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = pendingReward[msg.sender];
        if (reward == 0) revert NoRewardToHarvest();
        _payReward(msg.sender, reward);
    }

    /**
     * @notice Return `amount` staked LPT to the caller. Accrued RWD stays
     *         pending — harvest it separately, or use `exit()`.
     * @param amount LPT to withdraw, in base units.
     */
    function withdraw(uint256 amount) external nonReentrant {
        // ---- checks ----
        if (amount == 0) revert ZeroAmount();
        uint256 staked = stakedBalance[msg.sender];
        if (amount > staked) revert InsufficientStakedBalance(staked, amount);

        // ---- effects ----
        // Accrue at the OLD stake size, so the withdrawn part keeps what it earned.
        _updateReward(msg.sender);
        stakedBalance[msg.sender] = staked - amount;
        totalStaked -= amount;

        // ---- interactions ----
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Withdraw the caller's whole stake and harvest every pending
     *         reward in one transaction.
     * @dev All-or-nothing: if the farm cannot fund the reward, the whole call
     *      reverts with `InsufficientRewardFunding` and nothing moves. Use
     *      `withdraw(stakedBalance)` to recover the LPT on its own.
     */
    function exit() external nonReentrant {
        // ---- checks ----
        _updateReward(msg.sender);
        uint256 staked = stakedBalance[msg.sender];
        uint256 reward = pendingReward[msg.sender];
        if (staked == 0 && reward == 0) revert NothingToExit();

        // ---- effects + interactions ----
        if (staked > 0) {
            stakedBalance[msg.sender] = 0;
            totalStaked -= staked;
        }
        if (reward > 0) _payReward(msg.sender, reward);
        if (staked > 0) {
            stakingToken.safeTransfer(msg.sender, staked);
            emit Withdrawn(msg.sender, staked);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /**
     * @notice Rewards `user` could harvest right now, in RWD base units:
     *         `pendingReward + stakedBalance * rewardRate * elapsed / 1e18`.
     */
    function earned(address user) public view returns (uint256) {
        uint256 staked = stakedBalance[user];
        if (staked == 0) return pendingReward[user];
        uint256 elapsed = block.timestamp - lastUpdate[user];
        return pendingReward[user] + (staked * rewardRate * elapsed) / REWARD_PRECISION;
    }

    /// @notice RWD currently held by the farm and available to pay rewards.
    function rewardBalance() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Move everything accrued so far into `pendingReward` and restart the clock.
    function _updateReward(address user) private {
        pendingReward[user] = earned(user);
        lastUpdate[user] = block.timestamp;
    }

    /// @dev Pay `reward` RWD if the farm can fund it; otherwise revert and keep it pending.
    function _payReward(address user, uint256 reward) private {
        // ---- checks ----
        uint256 available = rewardToken.balanceOf(address(this));
        if (available < reward) revert InsufficientRewardFunding(available, reward);

        // ---- effects ----
        pendingReward[user] = 0;

        // ---- interactions ----
        rewardToken.safeTransfer(user, reward);
        emit RewardPaid(user, reward);
    }

    /// @dev The reward rate's units assume 18-decimal tokens.
    function _requireDecimals18(address token) private view {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals != 18) revert UnsupportedDecimals(token, decimals);
    }
}
