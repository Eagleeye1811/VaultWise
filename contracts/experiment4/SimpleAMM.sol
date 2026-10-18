// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SimpleAMM
 * @notice Experiment 4 of the VaultWise project — a single two-token liquidity
 *         pool priced by the constant-product rule `x * y = k`, with NO trading
 *         fee. Liquidity providers deposit Token A and Token B and receive LP
 *         shares; traders swap one token for the other against the pool.
 *
 * @dev LP shares are this contract's own ERC-20
 *      -----------------------------------------
 *      SimpleAMM inherits OpenZeppelin `ERC20`, so the pool *is* the LP-share
 *      token ("VaultWise LP", `vwLP`). `balanceOf`, `totalSupply`, `transfer`,
 *      `approve`, `allowance`, `transferFrom` and the `Transfer` / `Approval`
 *      events are all inherited, unmodified. Minting an LP share is `_mint`;
 *      burning one is `_burn`. There is no second ownership ledger.
 *
 *      Reserves
 *      --------
 *      `reserveA` / `reserveB` are the pool's *recorded* balances, updated only
 *      by `addLiquidity`, `removeLiquidity` and the two swaps. They are not read
 *      from `balanceOf(address(this))`, so tokens sent to this contract with a
 *      plain `transfer` are simply ignored — they cannot move the price. (There
 *      is deliberately no `skim`/`sync` function; that is out of scope.)
 *
 *      Constant-product maths and integer rounding
 *      -------------------------------------------
 *      For a Token A -> Token B swap, the experiment sheet specifies:
 *
 *          newReserveA = reserveA + amountAIn
 *          newReserveB = (reserveA * reserveB) / newReserveA
 *          amountBOut  = reserveB - newReserveB
 *
 *      and symmetrically for B -> A. With real numbers this keeps
 *      `newReserveA * newReserveB` exactly equal to `k = reserveA * reserveB`.
 *
 *      Solidity has no fractions: `/` rounds DOWN. Rounding `newReserveB` down
 *      would pay the trader up to one base unit too much and let `k` shrink a
 *      little on every swap, slowly leaking value from liquidity providers.
 *      This contract therefore rounds `newReserveB` UP (`Math.ceilDiv`). The
 *      result differs from the sheet's formula by at most 1 base unit of output,
 *      always in the pool's favour, and guarantees:
 *
 *          k  <=  newReserveA * newReserveB  <  k + newReserveA
 *
 *      i.e. the product is preserved *approximately* — never decreasing, and
 *      growing by at most the rounding remainder. Exact equality is generally
 *      impossible with integers, which is why the tests check this band rather
 *      than `==`.
 *
 *      Decimals
 *      --------
 *      The maths uses raw base units and does not rescale between tokens. This
 *      introductory pool assumes both tokens use compatible decimals (both
 *      MockERC20 deployments use 18), so the reserve ratio reads directly as a
 *      price. Pairing tokens with different decimals would still be
 *      arithmetically consistent, but the "price" would need rescaling to read.
 *
 *      Safety measures
 *      ---------------
 *      - `SafeERC20` for every token transfer.
 *      - `nonReentrant` (transient-storage variant, EIP-1153 — available on
 *        Sepolia and the default EVM target of Solidity 0.8.24+) on every
 *        state-changing function.
 *      - Checks -> effects -> interactions: validation first, then reserves and
 *        LP supply are updated, then tokens move. Any failure (e.g. a token
 *        transfer reverting) reverts the WHOLE transaction, including the
 *        already-written reserves and LP mint, so no partial state can survive.
 *      - Explicit balance/allowance checks before `transferFrom`, so Remix shows
 *        a clear custom error instead of a generic token revert.
 *
 *      Not supported: fee-on-transfer or rebasing tokens; the recorded reserves
 *      assume the amount sent is the amount received.
 *
 *      This is an educational, no-fee AMM for Sepolia testnet. It has no swap
 *      fee, no slippage limit parameter and no minimum-liquidity lock, and it is
 *      NOT production-ready. Never use it with real funds.
 */
contract SimpleAMM is ERC20, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice Token A of the pair (TKA in the experiment).
    IERC20 public immutable tokenA;

    /// @notice Token B of the pair (TKB in the experiment).
    IERC20 public immutable tokenB;

    /// @notice Recorded Token A reserve, in Token A base units.
    uint256 public reserveA;

    /// @notice Recorded Token B reserve, in Token B base units.
    uint256 public reserveB;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice A provider deposited both tokens and received `lpShares`.
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpShares);

    /// @notice A provider burned `lpShares` and received both tokens back.
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpShares);

    /// @notice A trader swapped `amountIn` of `tokenIn` for `amountOut` of `tokenOut`.
    event Swap(
        address indexed trader,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut
    );

    /// @notice The recorded reserves after any liquidity operation or swap.
    event Sync(uint256 reserveA, uint256 reserveB);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice A token address passed to the constructor was the zero address.
    error ZeroAddress();

    /// @notice Token A and Token B were the same address.
    error IdenticalTokens();

    /// @notice A token address passed to the constructor has no contract code.
    error NotAContract(address account);

    /// @notice An amount argument was zero.
    error ZeroAmount();

    /// @notice `getAmountOut` was asked about a token that is not in this pool.
    error InvalidToken(address token);

    /// @notice The caller holds fewer tokens than the operation needs.
    error InsufficientBalance(address token, uint256 available, uint256 required);

    /// @notice The caller has not approved this pool for enough tokens.
    error InsufficientAllowance(address token, uint256 allowed, uint256 required);

    /// @notice The caller tried to remove more LP shares than they own.
    error InsufficientLPBalance(uint256 available, uint256 required);

    /// @notice The deposit is too small to mint even one LP base unit.
    error InsufficientLiquidityMinted();

    /// @notice The pool has no liquidity on one or both sides.
    error InsufficientLiquidity();

    /// @notice The operation would pay out zero of a token.
    error InsufficientOutputAmount();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @notice Create the pool for one token pair.
     * @param _tokenA Address of Token A (deployed MockERC20 "TKA").
     * @param _tokenB Address of Token B (deployed MockERC20 "TKB").
     */
    constructor(address _tokenA, address _tokenB) ERC20("VaultWise LP", "vwLP") {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_tokenA == _tokenB) revert IdenticalTokens();
        // Catches a mistyped / EOA address in Remix at deploy time, instead of
        // producing a pool whose every call later fails.
        if (_tokenA.code.length == 0) revert NotAContract(_tokenA);
        if (_tokenB.code.length == 0) revert NotAContract(_tokenB);

        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /**
     * @notice Deposit Token A and Token B and receive LP shares.
     * @param amountA Token A to deposit, in base units. Must be approved first.
     * @param amountB Token B to deposit, in base units. Must be approved first.
     * @return lpShares LP shares minted to the caller.
     *
     * @dev First provider: `lpShares = sqrt(amountA * amountB)`, the geometric
     *      mean, so the share count does not depend on which token is "A".
     *
     *      Later providers: shares are proportional to the existing pool,
     *      `min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)`.
     *      Taking the minimum means a deposit off the current ratio is credited
     *      only for its *matched* part; the unmatched excess still enters the
     *      reserves and therefore benefits every existing LP. Deposit at the
     *      current reserve ratio (the frontend pre-fills it) to avoid that.
     */
    function addLiquidity(uint256 amountA, uint256 amountB)
        external
        nonReentrant
        returns (uint256 lpShares)
    {
        // ---- checks ----
        if (amountA == 0 || amountB == 0) revert ZeroAmount();
        _requireFundsAndAllowance(tokenA, amountA);
        _requireFundsAndAllowance(tokenB, amountB);

        uint256 supply = totalSupply();
        if (supply == 0) {
            lpShares = Math.sqrt(amountA * amountB);
        } else {
            // Unreachable while supply > 0 (reserves only reach zero when the
            // last share is burned), but guards the divisions below.
            if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
            lpShares = Math.min((amountA * supply) / reserveA, (amountB * supply) / reserveB);
        }
        if (lpShares == 0) revert InsufficientLiquidityMinted();

        // ---- effects ----
        reserveA += amountA;
        reserveB += amountB;
        _mint(msg.sender, lpShares);

        // ---- interactions ----
        // If either transfer fails the whole call reverts, undoing the reserve
        // update and the LP mint above — shares can never exist without assets.
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        emit LiquidityAdded(msg.sender, amountA, amountB, lpShares);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Burn LP shares and receive the proportional part of both reserves.
     * @param lpAmount LP shares to burn, in base units (18 decimals).
     * @return amountA Token A returned to the caller.
     * @return amountB Token B returned to the caller.
     *
     * @dev `amountX = lpAmount * reserveX / totalSupply`, rounded down, so the
     *      pool never pays out more than the caller's exact share. Burning the
     *      entire supply returns the entire reserves.
     */
    function removeLiquidity(uint256 lpAmount)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        // ---- checks ----
        if (lpAmount == 0) revert ZeroAmount();
        uint256 owned = balanceOf(msg.sender);
        if (lpAmount > owned) revert InsufficientLPBalance(owned, lpAmount);

        uint256 supply = totalSupply();
        amountA = (lpAmount * reserveA) / supply;
        amountB = (lpAmount * reserveB) / supply;
        // A dust-sized burn could round one side to zero; refuse rather than
        // destroy shares for nothing.
        if (amountA == 0 || amountB == 0) revert InsufficientOutputAmount();

        // ---- effects ----
        _burn(msg.sender, lpAmount);
        reserveA -= amountA;
        reserveB -= amountB;

        // ---- interactions ----
        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpAmount);
        emit Sync(reserveA, reserveB);
    }

    // ---------------------------------------------------------------------
    // Swaps
    // ---------------------------------------------------------------------

    /**
     * @notice Sell `amountAIn` Token A to the pool for Token B.
     * @param amountAIn Token A to sell, in base units. Must be approved first.
     * @return amountBOut Token B sent to the caller.
     */
    function swapAForB(uint256 amountAIn) external nonReentrant returns (uint256 amountBOut) {
        amountBOut = _swap(true, amountAIn);
    }

    /**
     * @notice Sell `amountBIn` Token B to the pool for Token A.
     * @param amountBIn Token B to sell, in base units. Must be approved first.
     * @return amountAOut Token A sent to the caller.
     */
    function swapBForA(uint256 amountBIn) external nonReentrant returns (uint256 amountAOut) {
        amountAOut = _swap(false, amountBIn);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Current recorded reserves.
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @notice Quote the output of a swap at the current reserves (read-only).
     * @param tokenIn  Address of the token being sold — `tokenA` or `tokenB`.
     * @param amountIn Amount being sold, in base units.
     * @return amountOut Amount of the other token the swap would pay now.
     * @dev A quote, not a promise: if another swap or liquidity change lands
     *      first, the reserves — and so the real output — will differ.
     */
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (tokenIn == address(tokenA)) return _quote(amountIn, reserveA, reserveB);
        if (tokenIn == address(tokenB)) return _quote(amountIn, reserveB, reserveA);
        revert InvalidToken(tokenIn);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Shared body of both swap directions.
    function _swap(bool aToB, uint256 amountIn) private returns (uint256 amountOut) {
        (IERC20 tokenIn, IERC20 tokenOut, uint256 reserveIn, uint256 reserveOut) = aToB
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        // ---- checks ----
        amountOut = _quote(amountIn, reserveIn, reserveOut);
        _requireFundsAndAllowance(tokenIn, amountIn);

        // ---- effects ----
        if (aToB) {
            reserveA = reserveIn + amountIn;
            reserveB = reserveOut - amountOut;
        } else {
            reserveB = reserveIn + amountIn;
            reserveA = reserveOut - amountOut;
        }

        // ---- interactions ----
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOut.safeTransfer(msg.sender, amountOut);

        emit Swap(msg.sender, address(tokenIn), amountIn, address(tokenOut), amountOut);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @dev No-fee constant-product quote:
     *
     *          newReserveIn  = reserveIn + amountIn
     *          newReserveOut = ceil(reserveIn * reserveOut / newReserveIn)
     *          amountOut     = reserveOut - newReserveOut
     *
     *      `ceil` instead of the sheet's floor division — see the contract-level
     *      note on rounding. Because `newReserveOut >= 1` whenever both reserves
     *      are non-zero, `amountOut < reserveOut` always: a swap can never drain
     *      a side of the pool to zero.
     */
    function _quote(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 newReserveIn = reserveIn + amountIn;
        uint256 newReserveOut = Math.ceilDiv(reserveIn * reserveOut, newReserveIn);
        amountOut = reserveOut - newReserveOut;

        if (amountOut == 0) revert InsufficientOutputAmount();
    }

    /// @dev Clear custom errors instead of a generic token revert in Remix.
    function _requireFundsAndAllowance(IERC20 token, uint256 amount) private view {
        uint256 available = token.balanceOf(msg.sender);
        if (available < amount) revert InsufficientBalance(address(token), available, amount);

        uint256 allowed = token.allowance(msg.sender, address(this));
        if (allowed < amount) revert InsufficientAllowance(address(token), allowed, amount);
    }
}
