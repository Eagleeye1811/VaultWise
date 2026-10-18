/**
 * Client-side mirrors of SimpleAMM's liquidity arithmetic, used ONLY for
 * on-screen estimates before a transaction is sent.
 *
 * Swap outputs are never computed here — the swap panel always asks the
 * contract (`getAmountOut`), so the number shown is the contract's own quote.
 * Liquidity estimates are computed locally because the contract has no preview
 * function for them; the formulas below are the exact integer formulas the
 * contract uses, applied to the reserves and supply just read from chain, so
 * they match what the contract would do *at those reserves*.
 *
 * All values are bigint base units.
 */

/** Integer square root (floor), same result as OpenZeppelin `Math.sqrt`. */
export function sqrt(value) {
  if (value < 0n) throw new Error("sqrt of negative");
  if (value < 2n) return value;
  // Newton's method, starting from a power of two >= sqrt(value).
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

const min = (a, b) => (a < b ? a : b);

/**
 * LP shares `addLiquidity(amountA, amountB)` would mint.
 *
 *   empty pool:  sqrt(amountA * amountB)
 *   otherwise:   min(amountA * supply / reserveA, amountB * supply / reserveB)
 */
export function estimateLpShares(amountA, amountB, reserveA, reserveB, supply) {
  if (amountA <= 0n || amountB <= 0n) return 0n;
  if (supply === 0n) return sqrt(amountA * amountB);
  if (reserveA === 0n || reserveB === 0n) return 0n;
  return min((amountA * supply) / reserveA, (amountB * supply) / reserveB);
}

/**
 * The other side's amount that matches the current reserve ratio, rounded up
 * so the paired deposit is never the limiting side of the `min` above.
 *
 * @returns {bigint|null} null when the pool is empty (any ratio is allowed).
 */
export function matchingAmount(amountIn, reserveIn, reserveOut) {
  if (reserveIn === 0n || reserveOut === 0n || amountIn <= 0n) return null;
  return (amountIn * reserveOut + reserveIn - 1n) / reserveIn;
}

/** Token A and Token B that `removeLiquidity(lpAmount)` would return. */
export function estimateRemoval(lpAmount, reserveA, reserveB, supply) {
  if (lpAmount <= 0n || supply === 0n) return { amountA: 0n, amountB: 0n };
  return {
    amountA: (lpAmount * reserveA) / supply,
    amountB: (lpAmount * reserveB) / supply,
  };
}

/**
 * `numerator / denominator` as a decimal string, from raw bigint amounts with
 * possibly different decimals. Used for the reserve ratio and the quote's
 * effective rate — both pure divisions of real on-chain numbers.
 */
export function formatRatio(numerator, numDecimals, denominator, denDecimals, digits = 6) {
  if (numerator === null || denominator === null || denominator === 0n) return "—";
  const scale = 10n ** BigInt(digits);
  const scaled =
    (numerator * 10n ** BigInt(denDecimals) * scale) / (denominator * 10n ** BigInt(numDecimals));
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0");
  return `${whole.toLocaleString("en-US")}.${fraction}`;
}

/** `part / whole` as a percentage string, e.g. "12.50%". */
export function formatShare(part, whole) {
  if (part === null || whole === null || whole === 0n) return "—";
  const basisPoints = (part * 10_000n) / whole;
  return `${(Number(basisPoints) / 100).toFixed(2)}%`;
}

/**
 * Price impact of a quoted swap, in parts per million (1 000 000 = 100%):
 *
 *   spot price       = reserveOut / reserveIn
 *   execution price  = amountOut / amountIn
 *   impact           = 1 − execution / spot = 1 − (amountOut · reserveIn) / (amountIn · reserveOut)
 *
 * Exact integer arithmetic on the contract's own quote — a calculation, not a
 * fee. With no fee, this is entirely the curve's slippage for this size.
 */
export function priceImpactPpm(amountIn, amountOut, reserveIn, reserveOut) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null;
  const ideal = amountIn * reserveOut; // output at the spot price, scaled by reserveIn
  const actual = amountOut * reserveIn;
  if (actual >= ideal) return 0n;
  return ((ideal - actual) * 1_000_000n) / ideal;
}

/** Format a ppm value as a percentage, e.g. 9901n -> "0.9901%". */
export function formatPpm(ppm, digits = 4) {
  if (ppm === null || ppm === undefined) return "—";
  return `${(Number(ppm) / 10_000).toFixed(digits)}%`;
}

/** Minimum acceptable output for a quote and a tolerance in basis points (50 = 0.5%). */
export function minOutForTolerance(quote, toleranceBps) {
  if (quote === null || quote === undefined) return null;
  return (quote * (10_000n - BigInt(toleranceBps))) / 10_000n;
}
