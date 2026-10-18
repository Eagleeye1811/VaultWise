// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title LPFarm (optional extension)
 * @notice Experiment 6 of the VaultWise project — the DEX's "rewards
 *         programme": liquidity providers stake their Pair LP tokens and earn
 *         a reward token at a fixed rate per second, shared in proportion to
 *         their stake.
 *
 * @dev Accounting without loops (the MasterChef pattern the sheet names)
 *      ------------------------------------------------------------------
 *          accRewardPerShare += elapsed * rewardPerSecond * 1e18 / totalStaked
 *          pending(user)      = amount * accRewardPerShare / 1e18 - rewardDebt
 *          rewardDebt         = amount * accRewardPerShare / 1e18   (after every change)
 *
 *      Each user's share of every interval is therefore computed in O(1), no
 *      matter how many users there are. Divisions round down, so the farm
 *      never promises more than `rewardPerSecond * elapsed`; the rounding dust
 *      stays in the farm. While nothing is staked, no rewards accrue.
 *
 *      Funding and claims
 *      ------------------
 *      The farm pays from the reward tokens it holds (anyone may transfer or
 *      mint them to it). `deposit` and `withdraw` pay the caller's pending
 *      reward up to the available balance and carry any shortfall in
 *      `unpaidReward`, to be paid by a later call — so an under-funded farm
 *      never blocks a withdrawal of LP tokens, and no earned reward is lost.
 *      `deposit(0)` is a plain claim.
 *
 *      Educational prototype — single pool, fixed rate, no owner. Not
 *      production-ready.
 */
contract LPFarm is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct UserInfo {
        uint256 amount; // LP tokens staked
        uint256 rewardDebt; // amount * accRewardPerShare / ACC_PRECISION at the last update
        uint256 unpaidReward; // earned but not yet paid because the farm was short of funds
    }

    uint256 public constant ACC_PRECISION = 1e18;

    /// @notice The Pair LP token being staked.
    IERC20 public immutable lpToken;

    /// @notice The token paid as reward.
    IERC20 public immutable rewardToken;

    /// @notice Reward-token base units emitted per second, shared by all stakers.
    uint256 public immutable rewardPerSecond;

    /// @notice Accumulated reward per staked LP base unit, scaled by ACC_PRECISION.
    uint256 public accRewardPerShare;

    /// @notice Last time accRewardPerShare was brought up to date.
    uint256 public lastRewardTime;

    /// @notice LP tokens staked by everyone.
    uint256 public totalStaked;

    mapping(address => UserInfo) public userInfo;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    error ZERO_ADDRESS();
    error IDENTICAL_ADDRESSES();
    error INSUFFICIENT_STAKE(uint256 staked, uint256 requested);

    constructor(address _lpToken, address _rewardToken, uint256 _rewardPerSecond) {
        if (_lpToken == address(0) || _rewardToken == address(0)) revert ZERO_ADDRESS();
        if (_lpToken == _rewardToken) revert IDENTICAL_ADDRESSES();
        lpToken = IERC20(_lpToken);
        rewardToken = IERC20(_rewardToken);
        rewardPerSecond = _rewardPerSecond;
        lastRewardTime = block.timestamp;
    }

    /// @notice Reward `user` has earned and not yet received, in reward base units.
    function pendingReward(address user) external view returns (uint256) {
        UserInfo storage u = userInfo[user];
        uint256 acc = accRewardPerShare;
        if (block.timestamp > lastRewardTime && totalStaked > 0) {
            acc += ((block.timestamp - lastRewardTime) * rewardPerSecond * ACC_PRECISION) / totalStaked;
        }
        return u.unpaidReward + (u.amount * acc) / ACC_PRECISION - u.rewardDebt;
    }

    /// @notice Bring accRewardPerShare up to now. Anyone may call it.
    function updatePool() public {
        if (block.timestamp <= lastRewardTime) return;
        if (totalStaked > 0) {
            accRewardPerShare +=
                ((block.timestamp - lastRewardTime) * rewardPerSecond * ACC_PRECISION) / totalStaked;
        }
        lastRewardTime = block.timestamp;
    }

    /**
     * @notice Stake `amount` LP tokens (approve the farm first) and receive any
     *         pending reward. `deposit(0)` only claims.
     */
    function deposit(uint256 amount) external nonReentrant {
        updatePool();
        UserInfo storage u = userInfo[msg.sender];
        uint256 paid = _settle(u);

        u.amount += amount;
        totalStaked += amount;
        u.rewardDebt = (u.amount * accRewardPerShare) / ACC_PRECISION;

        if (amount > 0) lpToken.safeTransferFrom(msg.sender, address(this), amount);
        _pay(paid);
        emit Deposit(msg.sender, amount);
    }

    /// @notice Unstake `amount` LP tokens and receive any pending reward.
    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage u = userInfo[msg.sender];
        if (amount > u.amount) revert INSUFFICIENT_STAKE(u.amount, amount);
        updatePool();
        uint256 paid = _settle(u);

        u.amount -= amount;
        totalStaked -= amount;
        u.rewardDebt = (u.amount * accRewardPerShare) / ACC_PRECISION;

        if (amount > 0) lpToken.safeTransfer(msg.sender, amount);
        _pay(paid);
        emit Withdraw(msg.sender, amount);
    }

    /**
     * @dev Effects half of a claim (pool already updated): work out everything
     *      owed, decide how much the farm can pay now, and record the rest in
     *      unpaidReward — all before any token moves.
     */
    function _settle(UserInfo storage u) private returns (uint256 paid) {
        uint256 owed = u.unpaidReward + (u.amount * accRewardPerShare) / ACC_PRECISION - u.rewardDebt;
        uint256 available = rewardToken.balanceOf(address(this));
        paid = owed < available ? owed : available;
        u.unpaidReward = owed - paid;
    }

    /// @dev Interactions half of a claim.
    function _pay(uint256 paid) private {
        if (paid == 0) return;
        rewardToken.safeTransfer(msg.sender, paid);
        emit RewardPaid(msg.sender, paid);
    }
}
