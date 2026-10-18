// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {Factory} from "./Factory.sol";
import {Pair} from "./Pair.sol";

/**
 * @title Router
 * @notice Experiment 6 of the VaultWise project — the DEX's "dashboard and
 *         steering": the friendly, safe entry point users talk to. It pulls
 *         the user's tokens with `transferFrom`, sends them to the right Pair,
 *         applies minimum-amount and deadline checks, and chains multi-hop
 *         swaps along a token path.
 *
 * @dev The Router holds no funds between calls. Every token it moves goes
 *      straight from the user to a Pair (`safeTransferFrom(user, pair, ...)`),
 *      so the user approves the Router, never the Pair.
 *
 *      Swap output with the 0.3 % fee (rounded down):
 *
 *          amountInWithFee = amountIn * 997
 *          amountOut = amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee)
 *
 *      Errors use the sheet's names (`EXPIRED`, `INSUFFICIENT_OUTPUT_AMOUNT`, ...).
 *      Fee-on-transfer tokens are not supported: the Pair would receive less
 *      than quoted and the swap reverts with `K`.
 */
contract Router is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice The Factory whose pairs this Router uses.
    address public immutable factory;

    error EXPIRED();
    error IDENTICAL_ADDRESSES();
    error ZERO_ADDRESS();
    error INSUFFICIENT_AMOUNT();
    error INSUFFICIENT_LIQUIDITY();
    error INSUFFICIENT_INPUT_AMOUNT();
    error INSUFFICIENT_OUTPUT_AMOUNT();
    error INSUFFICIENT_A_AMOUNT();
    error INSUFFICIENT_B_AMOUNT();
    error INVALID_PATH();
    error PAIR_NOT_FOUND(address tokenA, address tokenB);

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert EXPIRED();
        _;
    }

    constructor(address _factory) {
        if (_factory == address(0)) revert ZERO_ADDRESS();
        factory = _factory;
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /**
     * @notice Add liquidity to the A/B pool, creating the Pair if needed.
     * @dev The amounts actually used keep the current pool ratio: the side
     *      that would exceed the ratio is reduced (`quote`). Both must still
     *      meet their minimum. Approve the Router for both tokens first.
     * @return amountA   Token A actually deposited.
     * @return amountB   Token B actually deposited.
     * @return liquidity LP tokens minted to `to`.
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (Factory(factory).getPair(tokenA, tokenB) == address(0)) Factory(factory).createPair(tokenA, tokenB);
        (amountA, amountB) = _optimalAmounts(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        liquidity = _deposit(tokenA, tokenB, amountA, amountB, to);
    }

    /**
     * @notice Burn `liquidity` LP tokens and receive both tokens back.
     * @dev Approve the Router to spend your LP tokens (the Pair's ERC-20) first.
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _pairFor(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = Pair(pair).burn(to);

        (address token0, ) = sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin) revert INSUFFICIENT_A_AMOUNT();
        if (amountB < amountBMin) revert INSUFFICIENT_B_AMOUNT();
    }

    // ---------------------------------------------------------------------
    // Swaps
    // ---------------------------------------------------------------------

    /**
     * @notice Sell exactly `amountIn` of `path[0]` for as much `path[last]` as
     *         the pools give, through every pool along `path`.
     * @param amountIn     Input amount, in base units of path[0].
     * @param amountOutMin Revert unless the final output is at least this.
     * @param path         Token route, e.g. [A, B] or [A, B, C]; each
     *                     consecutive pair must have a pool.
     * @param to           Receives the final output.
     * @param deadline     Unix time after which the swap reverts with EXPIRED.
     * @return amounts     amounts[0] = amountIn, amounts[i] = output of hop i.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert INSUFFICIENT_OUTPUT_AMOUNT();

        IERC20(path[0]).safeTransferFrom(msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    // ---------------------------------------------------------------------
    // Helpers (the sheet's library functions)
    // ---------------------------------------------------------------------

    /// @notice Sort two token addresses; reverts on identical or zero addresses.
    function sortTokens(address tokenA, address tokenB) public pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IDENTICAL_ADDRESSES();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZERO_ADDRESS();
    }

    /// @notice Reserves of the A/B pool in (A, B) order; (0, 0) if the pool does not exist.
    function getReserves(address tokenA, address tokenB) public view returns (uint256 reserveA, uint256 reserveB) {
        (address token0, ) = sortTokens(tokenA, tokenB);
        address pair = Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);
        (uint256 reserve0, uint256 reserve1) = Pair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    /// @notice Amount of B that keeps the pool ratio for `amountA` of A: amountA * reserveB / reserveA.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        if (amountA == 0) revert INSUFFICIENT_AMOUNT();
        if (reserveA == 0 || reserveB == 0) revert INSUFFICIENT_LIQUIDITY();
        amountB = (amountA * reserveB) / reserveA;
    }

    /// @notice Output of one swap with the 0.3 % fee, rounded down.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert INSUFFICIENT_INPUT_AMOUNT();
        if (reserveIn == 0 || reserveOut == 0) revert INSUFFICIENT_LIQUIDITY();
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @notice Every hop's output along `path`; amounts[0] is `amountIn`.
    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        if (path.length < 2) revert INVALID_PATH();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            _pairFor(path[i], path[i + 1]); // a missing pool reverts with PAIR_NOT_FOUND
            (uint256 reserveIn, uint256 reserveOut) = getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _pairFor(address tokenA, address tokenB) private view returns (address pair) {
        sortTokens(tokenA, tokenB);
        pair = Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) revert PAIR_NOT_FOUND(tokenA, tokenB);
    }

    /// @dev The ratio-preserving amounts for addLiquidity.
    function _optimalAmounts(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private view returns (uint256 amountA, uint256 amountB) {
        (uint256 reserveA, uint256 reserveB) = getReserves(tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            // empty pool: the first provider sets the price
            return (amountADesired, amountBDesired);
        }
        uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
        if (amountBOptimal <= amountBDesired) {
            if (amountBOptimal < amountBMin) revert INSUFFICIENT_B_AMOUNT();
            return (amountADesired, amountBOptimal);
        }
        uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
        // amountAOptimal <= amountADesired holds whenever amountBOptimal > amountBDesired
        if (amountAOptimal < amountAMin) revert INSUFFICIENT_A_AMOUNT();
        return (amountAOptimal, amountBDesired);
    }

    /// @dev Send both tokens from the user straight to the Pair, then mint LP to `to`.
    function _deposit(address tokenA, address tokenB, uint256 amountA, uint256 amountB, address to)
        private
        returns (uint256 liquidity)
    {
        address pair = _pairFor(tokenA, tokenB);
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = Pair(pair).mint(to);
    }

    /// @dev Chain the swaps: each Pair sends its output straight to the next Pair.
    function _swap(uint256[] memory amounts, address[] calldata path, address to) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address recipient = i < path.length - 2 ? _pairFor(output, path[i + 2]) : to;
            Pair(_pairFor(input, output)).swap(amount0Out, amount1Out, recipient);
        }
    }
}
