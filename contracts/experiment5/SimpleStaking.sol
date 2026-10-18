// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title SimpleStaking
 * @notice Experiment 5, Part 2 of the VaultWise project — protocol-token
 *         staking. A user stakes the protocol token ABC and earns a reward
 *         token (RWD) for every second the ABC stays staked.
 *
 *         Contract set (two Solidity sources, as the experiment sheet asks):
 *
 *             MockERC20.sol      deployed twice: ("Protocol Token", "ABC") and
 *                                ("Reward Token", "RWD")
 *             SimpleStaking.sol  deployed once with (ABC, RWD)
 *
 *         `MockERC20.sol` is the generic test token in `contracts/experiment4/`,
 *         reused unchanged.
 *
 *         This is protocol-token staking, deliberately kept separate from
 *         Part 1's LP-token yield farming: no liquidity pool is involved, so
 *         the staked position carries no impermanent loss. It is NOT validator
 *         staking or Proof-of-Stake consensus.
 *
 * @dev Reward model
 *      ------------
 *          Reward = Staked Amount x Reward Rate x Elapsed Time
 *
 *      with Reward Rate = 0.001 RWD per ABC per second, so 100 ABC staked for
 *      60 s earns 100 x 0.001 x 60 = 6 RWD.
 *
 *      Units and integer precision
 *      ---------------------------
 *          rewardRate       = 1e15   RWD base units per WHOLE ABC per second
 *                                    (1e15 / 1e18 = 0.001 RWD)
 *          REWARD_PRECISION = 1e18   ABC base units in one whole ABC
 *
 *          accrued = stakedBalance * rewardRate * elapsedSeconds / REWARD_PRECISION
 *
 *      `stakedBalance` is in ABC base units, `accrued` in RWD base units.
 *      100e18 * 1e15 * 60 / 1e18 = 6e18 = 6 RWD exactly. Both tokens must have
 *      18 decimals (enforced in the constructor). The division rounds DOWN, so
 *      each checkpoint loses strictly less than one RWD base unit, always in
 *      the contract's favour.
 *
 *      Reward accounting
 *      -----------------
 *      Before any stake change or payout, `_updateReward` moves everything
 *      earned so far into `pendingReward[user]` and resets `lastUpdate[user]`
 *      to now. Additional stakes and partial unstakes therefore never lose or
 *      re-price rewards already accrued.
 *
 *      Reward funding
 *      --------------
 *      Rewards are paid only from the RWD this contract holds (minted or
 *      transferred to its address). A payout above that balance reverts with
 *      `InsufficientRewardFunding` and stays pending. `unstake()` never touches
 *      RWD, so staked ABC is always recoverable.
 *
 *      Safety measures
 *      ---------------
 *      SafeERC20 for every transfer; `nonReentrant` on every state-changing
 *      function; checks -> effects -> interactions; explicit balance,
 *      allowance, stake and funding checks; staking and reward tokens must
 *      differ; fee-on-transfer staking tokens are rejected.
 *
 *      Educational contract for a local chain or Sepolia. Not production-ready —
 *      never use it with real funds.
 */
contract SimpleStaking is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Reward rate: RWD base units paid per WHOLE staked ABC per second.
    ///         1e15 = 0.001 RWD (18 decimals). Named as in the experiment sheet.
    uint256 public constant rewardRate = 1e15;

    /// @notice ABC base units in one whole ABC (18 decimals).
    uint256 public constant REWARD_PRECISION = 1e18;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The protocol token being staked (ABC).
    IERC20 public immutable stakingToken;

    /// @notice The token paid as staking reward (RWD).
    IERC20 public immutable rewardToken;

    /// @notice ABC currently staked by each user, in base units.
    mapping(address => uint256) public stakedBalance;

    /// @notice Timestamp up to which each user's reward has been accrued.
    mapping(address => uint256) public lastUpdate;

    /// @notice Rewards accrued but not yet claimed, in RWD base units.
    mapping(address => uint256) public pendingReward;

    /// @notice Sum of every user's `stakedBalance`.
    uint256 public totalStaked;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice `user` staked `amount` ABC.
    event Staked(address indexed user, uint256 amount);

    /// @notice `user` claimed `reward` RWD.
    event RewardClaimed(address indexed user, uint256 reward);

    /// @notice `amount` staked ABC was returned to `user`.
    event Unstaked(address indexed user, uint256 amount);

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

    /// @notice The caller holds less ABC than they tried to stake.
    error InsufficientBalance(uint256 available, uint256 required);

    /// @notice The caller has not approved the staking contract for enough ABC.
    error InsufficientAllowance(uint256 allowed, uint256 required);

    /// @notice The caller tried to unstake more ABC than they have staked.
    error InsufficientStakedBalance(uint256 staked, uint256 requested);

    /// @notice The contract holds less RWD than the reward it must pay.
    error InsufficientRewardFunding(uint256 available, uint256 required);

    /// @notice `claimReward()` was called with no reward accrued.
    error NoRewardToClaim();

    /// @notice `exit()` was called with neither a stake nor a pending reward.
    error NothingToExit();

    /// @notice The contract received a different ABC amount than was sent.
    error TransferAmountMismatch(uint256 expected, uint256 received);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @notice Create the staking contract for one staking/reward token pair.
     * @param _stakingToken Address of the protocol token (MockERC20 "ABC").
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
    // Staking
    // ---------------------------------------------------------------------

    /**
     * @notice Stake `amount` ABC. Approve this contract for at least `amount` first.
     * @param amount ABC to stake, in base units (100 ABC = 100 * 10**18).
     */
    function stake(uint256 amount) external nonReentrant {
        // ---- checks ----
        if (amount == 0) revert ZeroAmount();
        uint256 available = stakingToken.balanceOf(msg.sender);
        if (available < amount) revert InsufficientBalance(available, amount);
        uint256 allowed = stakingToken.allowance(msg.sender, address(this));
        if (allowed < amount) revert InsufficientAllowance(allowed, amount);

        // ---- effects ----
        _updateReward(msg.sender);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        // ---- interactions ----
        uint256 before = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - before;
        if (received != amount) revert TransferAmountMismatch(amount, received);

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Pay the caller every RWD accrued so far.
     * @dev Reverts with `NoRewardToClaim` when nothing has accrued, and with
     *      `InsufficientRewardFunding` when the contract cannot cover it.
     */
    function claimReward() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = pendingReward[msg.sender];
        if (reward == 0) revert NoRewardToClaim();
        _payReward(msg.sender, reward);
    }

    /**
     * @notice Return `amount` staked ABC to the caller. Accrued RWD stays
     *         pending — claim it separately, or use `exit()`.
     * @param amount ABC to unstake, in base units.
     */
    function unstake(uint256 amount) external nonReentrant {
        // ---- checks ----
        if (amount == 0) revert ZeroAmount();
        uint256 staked = stakedBalance[msg.sender];
        if (amount > staked) revert InsufficientStakedBalance(staked, amount);

        // ---- effects ----
        _updateReward(msg.sender);
        stakedBalance[msg.sender] = staked - amount;
        totalStaked -= amount;

        // ---- interactions ----
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Unstake all ABC and claim every pending reward in one transaction.
     * @dev All-or-nothing: if the contract cannot fund the reward, the whole
     *      call reverts and nothing moves. `unstake(stakedBalance)` still works.
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
            emit Unstaked(msg.sender, staked);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /**
     * @notice Rewards `user` could claim right now, in RWD base units:
     *         `pendingReward + stakedBalance * rewardRate * elapsed / 1e18`.
     */
    function earned(address user) public view returns (uint256) {
        uint256 staked = stakedBalance[user];
        if (staked == 0) return pendingReward[user];
        uint256 elapsed = block.timestamp - lastUpdate[user];
        return pendingReward[user] + (staked * rewardRate * elapsed) / REWARD_PRECISION;
    }

    /// @notice RWD currently held by the contract and available to pay rewards.
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

    /// @dev Pay `reward` RWD if the contract can fund it; otherwise revert and keep it pending.
    function _payReward(address user, uint256 reward) private {
        // ---- checks ----
        uint256 available = rewardToken.balanceOf(address(this));
        if (available < reward) revert InsufficientRewardFunding(available, reward);

        // ---- effects ----
        pendingReward[user] = 0;

        // ---- interactions ----
        rewardToken.safeTransfer(user, reward);
        emit RewardClaimed(user, reward);
    }

    /// @dev The reward rate's units assume 18-decimal tokens.
    function _requireDecimals18(address token) private view {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals != 18) revert UnsupportedDecimals(token, decimals);
    }
}
