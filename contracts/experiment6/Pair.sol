// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title Pair
 * @notice Experiment 6 of the VaultWise project — the DEX's liquidity pool and
 *         AMM in one contract ("fuel tank and engine"). It holds the reserves
 *         of two tokens, prices swaps with the constant-product rule and a
 *         0.3 % fee, and is itself the ERC-20 LP token of the pool.
 *
 * @dev Design rule from the sheet: the Pair is simple and strict
 *      ---------------------------------------------------------
 *      The Pair NEVER pulls tokens from users. The Router (or anyone) transfers
 *      tokens to the Pair first; `mint`, `burn` and `swap` then work out what
 *      arrived as `balance - reserve` and revert if the maths is wrong. Reserves
 *      are the balances recorded at the end of the last operation.
 *
 *      Formulas (all divisions round DOWN, in the pool's favour)
 *      ---------------------------------------------------------
 *          first deposit   liquidity = sqrt(amount0 * amount1) - 1000
 *                          (1000 LP = MINIMUM_LIQUIDITY locked forever)
 *          later deposit   liquidity = min(amount0 * supply / reserve0,
 *                                          amount1 * supply / reserve1)
 *          burn            amountX   = liquidity * balanceX / supply
 *          swap check      (bal0*1000 - in0*3) * (bal1*1000 - in1*3)
 *                              >= reserve0 * reserve1 * 1000^2      else K
 *
 *      The 0.3 % fee stays in the reserves, so k grows after every trade;
 *      there is no separate fee variable.
 *
 *      Locked liquidity
 *      ----------------
 *      Uniswap V2 mints the 1000 locked LP tokens to address(0). OpenZeppelin's
 *      ERC20 forbids minting to address(0), so they are minted to the
 *      conventional burn address 0x...dEaD instead. Nobody holds its key, so
 *      they are equally locked forever and still count in `totalSupply`.
 *
 *      Errors use the sheet's names (`K`, `INSUFFICIENT_INPUT_AMOUNT`, ...).
 *
 *      Educational prototype — no flash-swap callback, no protocol fee, no
 *      price oracle, no skim/sync. Not production-ready.
 */
contract Pair is ERC20, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants and state
    // ---------------------------------------------------------------------

    /// @notice LP tokens permanently locked by the first deposit.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @notice Where the locked LP tokens live (OpenZeppelin cannot mint to address(0)).
    address public constant LOCK_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice The Factory that deployed this Pair; the only account allowed to initialize it.
    address public immutable factory;

    /// @notice The lower-addressed token of the pair.
    address public token0;

    /// @notice The higher-addressed token of the pair.
    address public token1;

    /// @notice Recorded token0 balance after the last mint/burn/swap.
    uint256 public reserve0;

    /// @notice Recorded token1 balance after the last mint/burn/swap.
    uint256 public reserve1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Liquidity added: `amount0`/`amount1` arrived and `liquidity` LP went to `to`.
    event Mint(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity, address indexed to);

    /// @notice Liquidity removed: `liquidity` LP burned and both amounts sent to `to`.
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity, address indexed to);

    /// @notice A swap: inputs worked out from balances, outputs sent to `to`.
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );

    /// @notice The reserves after any mint, burn or swap.
    event Sync(uint256 reserve0, uint256 reserve1);

    // ---------------------------------------------------------------------
    // Errors (names from the experiment sheet)
    // ---------------------------------------------------------------------

    error FORBIDDEN();
    error ALREADY_INITIALIZED();
    error INSUFFICIENT_LIQUIDITY_MINTED();
    error INSUFFICIENT_LIQUIDITY_BURNED();
    error INSUFFICIENT_OUTPUT_AMOUNT();
    error INSUFFICIENT_LIQUIDITY();
    error INVALID_TO();
    error INSUFFICIENT_INPUT_AMOUNT();
    error K();

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    constructor() ERC20("VaultWise DEX LP", "VWDEX-LP") {
        factory = msg.sender;
    }

    /**
     * @notice Set the two tokens. Called exactly once, by the Factory, right
     *         after deployment, with the addresses already sorted.
     */
    function initialize(address _token0, address _token1) external {
        if (msg.sender != factory) revert FORBIDDEN();
        if (token0 != address(0)) revert ALREADY_INITIALIZED();
        token0 = _token0;
        token1 = _token1;
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /**
     * @notice Issue LP tokens for the tokens already sent to this Pair.
     * @param to Receives the LP tokens.
     * @return liquidity LP tokens minted to `to`.
     */
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1);
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 supply = totalSupply();
        if (supply == 0) {
            uint256 root = Math.sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert INSUFFICIENT_LIQUIDITY_MINTED();
            liquidity = root - MINIMUM_LIQUIDITY;
            _mint(LOCK_ADDRESS, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / _reserve0, (amount1 * supply) / _reserve1);
        }
        if (liquidity == 0) revert INSUFFICIENT_LIQUIDITY_MINTED();
        _mint(to, liquidity);

        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1, liquidity, to);
    }

    /**
     * @notice Destroy the LP tokens already sent to this Pair and return the
     *         holder's pro-rata share of both tokens.
     * @param to Receives both tokens.
     */
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        (address _token0, address _token1) = (token0, token1);
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));

        uint256 supply = totalSupply();
        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        if (amount0 == 0 || amount1 == 0) revert INSUFFICIENT_LIQUIDITY_BURNED();

        // effects first: shares are destroyed before any token leaves
        _burn(address(this), liquidity);
        IERC20(_token0).safeTransfer(to, amount0);
        IERC20(_token1).safeTransfer(to, amount1);

        _update(IERC20(_token0).balanceOf(address(this)), IERC20(_token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, liquidity, to);
    }

    // ---------------------------------------------------------------------
    // Swap
    // ---------------------------------------------------------------------

    /**
     * @notice Pay out `amount0Out`/`amount1Out` to `to`, then require that
     *         enough input was sent to keep the fee-adjusted invariant.
     * @dev The input must already be in the Pair; this function never pulls it.
     */
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert INSUFFICIENT_OUTPUT_AMOUNT();
        (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1);
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert INSUFFICIENT_LIQUIDITY();

        if (to == token0 || to == token1) revert INVALID_TO();

        // 1. pay the output optimistically
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);

        // 2 + 3. work out the input from the balances and check the invariant
        (uint256 amount0In, uint256 amount1In) = _checkSwap(amount0Out, amount1Out, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Current reserves, in (token0, token1) order.
    function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1) {
        return (reserve0, reserve1);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /**
     * @dev Second half of `swap` (split out only to stay within the EVM stack
     *      limit). Input = balance - (reserve - output); then the fee-adjusted
     *      invariant, with the 0.3 % fee taken off the input:
     *          (bal0*1000 - in0*3) * (bal1*1000 - in1*3) >= r0 * r1 * 1000^2
     *      On success the new balances become the reserves.
     */
    function _checkSwap(uint256 amount0Out, uint256 amount1Out, uint256 _reserve0, uint256 _reserve1)
        private
        returns (uint256 amount0In, uint256 amount1In)
    {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert INSUFFICIENT_INPUT_AMOUNT();

        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
        if (balance0Adjusted * balance1Adjusted < _reserve0 * _reserve1 * 1000 ** 2) revert K();

        _update(balance0, balance1);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
        emit Sync(balance0, balance1);
    }
}
