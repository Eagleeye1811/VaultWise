import { formatUnits } from "ethers";

/**
 * DEX arithmetic and revert explanations for Experiment 6, as pure functions
 * so they can be tested against the real contracts without a browser
 * (see test/experiment6.frontend.test.js).
 *
 * Every formula mirrors Router.sol exactly, in integer arithmetic:
 *
 *     getAmountOut  = in*997*rOut / (rIn*1000 + in*997)        (floor)
 *     quote         = amountA * reserveB / reserveA            (floor)
 *
 * The UI uses these to explain a trade before it is sent; just before sending
 * it re-quotes with the Router's own getAmountsOut on fresh reserves.
 */

const fmt = (raw, decimals = 18) => formatUnits(raw, decimals);

/** Router.getAmountOut. Returns null instead of reverting. */
export function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn === null || amountIn <= 0n || !reserveIn || !reserveOut) return null;
  const withFee = amountIn * 997n;
  return (withFee * reserveOut) / (reserveIn * 1000n + withFee);
}

/**
 * Router.getAmountsOut along `path`, using reserves already read.
 * @param {bigint} amountIn
 * @param {string[]} path                 token keys, e.g. ["A", "B", "C"]
 * @param {(x: string, y: string) => [bigint, bigint] | null} reservesOf  reserves in (x, y) order
 * @returns {bigint[] | null}  null when a hop has no pool or no liquidity
 */
export function getAmountsOut(amountIn, path, reservesOf) {
  if (path.length < 2) return null;
  const amounts = [amountIn];
  for (let i = 0; i < path.length - 1; i += 1) {
    const reserves = reservesOf(path[i], path[i + 1]);
    if (!reserves) return null;
    const out = getAmountOut(amounts[i], reserves[0], reserves[1]);
    if (out === null) return null;
    amounts.push(out);
  }
  return amounts;
}

/** Router.quote: the amount of B that keeps the pool ratio for `amountA`. */
export function quote(amountA, reserveA, reserveB) {
  if (amountA === null || amountA <= 0n || !reserveA || !reserveB) return null;
  return (amountA * reserveB) / reserveA;
}

/**
 * The amounts Router.addLiquidity will actually take (its _optimalAmounts),
 * before minimums. An empty pool takes both desired amounts.
 */
export function optimalAmounts(desiredA, desiredB, reserveA, reserveB) {
  if (!reserveA && !reserveB) return { amountA: desiredA, amountB: desiredB };
  const bOptimal = quote(desiredA, reserveA, reserveB);
  if (bOptimal !== null && bOptimal <= desiredB) return { amountA: desiredA, amountB: bOptimal };
  return { amountA: quote(desiredB, reserveB, reserveA), amountB: desiredB };
}

/** LP tokens Pair.mint will issue for `amountA`/`amountB` (sorted to the pair's reserves). */
export function estimateLiquidity(amountA, amountB, reserveA, reserveB, supply) {
  if (amountA === null || amountB === null) return null;
  if (!supply) {
    const root = sqrt(amountA * amountB);
    return root > 1000n ? root - 1000n : 0n;
  }
  const a = (amountA * supply) / reserveA;
  const b = (amountB * supply) / reserveB;
  return a < b ? a : b;
}

/** What Pair.burn returns for `liquidity` LP tokens. */
export function estimateBurn(liquidity, reserveA, reserveB, supply) {
  if (!liquidity || !supply) return null;
  return { amountA: (liquidity * reserveA) / supply, amountB: (liquidity * reserveB) / supply };
}

/** Integer square root (floor), as Pair uses for the first deposit. */
export function sqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Minimum acceptable amount for a slippage tolerance in basis points (50 = 0.5 %), rounded down. */
export function applySlippage(amount, toleranceBps) {
  if (amount === null || amount === undefined) return null;
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(toleranceBps))));
  return (amount * (10_000n - bps)) / 10_000n;
}

/**
 * A deadline `minutes` after the CHAIN's latest block time (not the local
 * clock, which may be skewed). Returns a unix timestamp in seconds.
 */
export function deadlineFrom(blockTimestamp, minutes) {
  return BigInt(blockTimestamp) + BigInt(Math.max(1, Math.round(minutes * 60)));
}

/**
 * Candidate routes from `from` to `to` among `tokenKeys`: the direct pool
 * and every one-intermediate route, kept only if every hop has liquidity.
 * @returns {string[][]}
 */
export function findRoutes(from, to, tokenKeys, hasLiquidity) {
  if (!from || !to || from === to) return [];
  const routes = [];
  if (hasLiquidity(from, to)) routes.push([from, to]);
  for (const mid of tokenKeys) {
    if (mid === from || mid === to) continue;
    if (hasLiquidity(from, mid) && hasLiquidity(mid, to)) routes.push([from, mid, to]);
  }
  return routes;
}

/** Spot-price impact of a single hop in parts per million: how far the execution rate is below the spot rate. */
export function priceImpactPpm(amountIn, amountOut, reserveIn, reserveOut) {
  if (!amountIn || !amountOut || !reserveIn || !reserveOut) return null;
  // spot out for amountIn = amountIn * reserveOut / reserveIn
  const spotOut = (amountIn * reserveOut) / reserveIn;
  if (spotOut === 0n) return null;
  return Number(((spotOut - amountOut) * 1_000_000n) / spotOut);
}

/**
 * Pull the custom error out of an ethers error, whichever shape it arrived in.
 * Tries each interface in turn (Router, Pair, Factory, token).
 * @returns {{ name: string, args: any[] } | null}
 */
export function decodeRevert(error, ifaces = []) {
  if (error?.revert?.name) return error.revert;
  const data = [error?.data, error?.info?.error?.data, error?.error?.data].find(
    (value) => typeof value === "string" && value.startsWith("0x") && value.length >= 10
  );
  if (!data) return null;
  for (const iface of ifaces) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { name: parsed.name, args: [...parsed.args] };
    } catch {
      // not this contract's error
    }
  }
  return null;
}

/**
 * Explain a DEX revert in the experiment sheet's own terms.
 * @param {{ name: string, args: any[] } | null} revert
 * @param {{ symbolOf?: (address: string) => string, decimals?: number }} [ctx]
 * @returns {string|null}
 */
export function explainRevert(revert, ctx = {}) {
  if (!revert?.name) return null;
  const symbolOf = ctx.symbolOf ?? ((address) => address);
  const decimals = ctx.decimals ?? 18;
  const n = (i) => fmt(BigInt(revert.args?.[i] ?? 0), decimals);

  switch (revert.name) {
    case "EXPIRED":
      return "EXPIRED — the deadline passed before the transaction was mined. Send it again with a later deadline.";
    case "INSUFFICIENT_OUTPUT_AMOUNT":
      return "INSUFFICIENT_OUTPUT_AMOUNT — the pool now pays less than your minimum received (the price moved). Re-quote, or raise the slippage tolerance.";
    case "INSUFFICIENT_INPUT_AMOUNT":
      return "INSUFFICIENT_INPUT_AMOUNT — the amount must be greater than zero.";
    case "INSUFFICIENT_A_AMOUNT":
    case "INSUFFICIENT_B_AMOUNT":
      return `${revert.name} — at the current pool ratio one side would be below its minimum. Re-read the pool and lower the minimum, or deposit closer to the ratio.`;
    case "INSUFFICIENT_LIQUIDITY":
      return "INSUFFICIENT_LIQUIDITY — the pool is empty on one side, or the output would drain it.";
    case "INSUFFICIENT_LIQUIDITY_MINTED":
      return "INSUFFICIENT_LIQUIDITY_MINTED — the deposit is too small: the first deposit must exceed the 1,000 locked LP base units, and a later one must mint at least 1.";
    case "INSUFFICIENT_LIQUIDITY_BURNED":
      return "INSUFFICIENT_LIQUIDITY_BURNED — that LP amount is too small to return any of one token.";
    case "INSUFFICIENT_AMOUNT":
      return "INSUFFICIENT_AMOUNT — enter an amount greater than zero.";
    case "K":
      return "K — the fee-adjusted constant-product check failed: the pool would end up with less than x·y = k allows.";
    case "INVALID_PATH":
      return "INVALID_PATH — a route needs at least two tokens.";
    case "PAIR_NOT_FOUND":
      return `PAIR_NOT_FOUND — there is no ${symbolOf(revert.args?.[0])}/${symbolOf(revert.args?.[1])} pool. Create it or pick another route.`;
    case "PAIR_EXISTS":
      return "PAIR_EXISTS — this pair has already been created; the Factory allows one per token combination.";
    case "IDENTICAL_ADDRESSES":
      return "IDENTICAL_ADDRESSES — choose two different tokens.";
    case "ZERO_ADDRESS":
      return "ZERO_ADDRESS — a token address is missing.";
    case "ERC20InsufficientAllowance":
      return `The Router is approved for only ${n(1)} of this token but needs ${n(2)}. Approve it first (the transferFrom fails otherwise).`;
    case "ERC20InsufficientBalance":
      return `Your wallet holds ${n(1)} of this token but the transaction needs ${n(2)}.`;
    case "ReentrancyGuardReentrantCall":
      return "A re-entrant call was blocked by the reentrancy lock.";
    case "SafeERC20FailedOperation":
      return "A token transfer reported failure, so the whole transaction was reverted.";
    default:
      return null;
  }
}
