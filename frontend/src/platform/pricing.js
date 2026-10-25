/**
 * USD valuation from the PriceOracle. Pure functions over the protocol
 * snapshot, shared by every page and checked against the compiled contract
 * in test/oracle.frontend.test.js.
 *
 * Prices are 18-decimal bigints (1e18 = $1), exactly as PriceOracle returns
 * them, and every value stays a bigint until it is formatted. Only a price
 * whose status is "ok" is ever used: a stale or invalid feed makes the value
 * unknown (null), never a guess.
 */

/** PriceOracle.Status, by enum index. */
export const PRICE_STATUS = ["ok", "noFeed", "invalid", "stale"];

const WAD = 10n ** 18n;

/**
 * One snapshot entry from a `tryGetPrice` result, or from a failed call (null).
 * @returns {{ status: string, price: bigint|null, updatedAt: number|null }}
 */
export function toPriceEntry(result) {
  if (!result) return { status: "error", price: null, updatedAt: null };
  const [status, price, updatedAt] = result;
  return {
    status: PRICE_STATUS[Number(status)] ?? "error",
    price: price > 0n ? price : null,
    updatedAt: updatedAt > 0n ? Number(updatedAt) : null,
  };
}

/** The usable price of a token, or null. `prices` is keyed by registry id. */
export function usablePrice(token, prices) {
  const entry = token && prices?.[token.id];
  return entry?.status === "ok" ? entry.price : null;
}

/** USD value (18 decimals) of `raw` base units of `token`, rounded down; null when unknown. */
export function usdValue(raw, token, prices) {
  const price = usablePrice(token, prices);
  if (raw === null || raw === undefined || price === null) return null;
  return (raw * price) / 10n ** BigInt(token.decimals ?? 18);
}

/** Sum of values, or null if any is unknown — a partial total would understate. */
export function sumUsd(values) {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined) return null;
    total += value;
  }
  return total;
}

/** Value of a position's holdings (not its pending reward). */
export function positionUsd(position, prices) {
  return sumUsd(position.holdings.map((h) => usdValue(h.raw, h.token, prices)));
}

/**
 * Total value locked per product, from the snapshot. A product that is not
 * deployed is omitted; one that is deployed but unpriced is null.
 *
 * @param {object} data        protocol snapshot
 * @param {Record<string,string>} dexTokenId  DEX token key -> registry id
 * @returns {{ byProduct: Record<string, bigint|null>, total: bigint, complete: boolean }}
 */
export function protocolTvl(data, dexTokenId) {
  const t = data.tokens;
  const p = data.prices;
  const ETH = { id: "ETH", decimals: 18 };
  const byProduct = {};

  if (data.dex.configured) {
    const pairs = Object.values(data.dex.pairs).filter((pair) => pair.address);
    byProduct.dex = sumUsd(
      pairs.flatMap((pair) => [usdValue(pair.reserveX, t[dexTokenId[pair.x]], p), usdValue(pair.reserveY, t[dexTokenId[pair.y]], p)])
    );
  }
  if (data.amm.configured) byProduct.amm = sumUsd([usdValue(data.amm.reserveA, t.TKA, p), usdValue(data.amm.reserveB, t.TKB, p)]);
  if (data.vault4626.configured) byProduct.vault4626 = usdValue(data.vault4626.totalAssets, t.USDC, p);
  if (data.ethVault.configured) byProduct.ethVault = usdValue(data.ethVault.total, ETH, p);
  if (data.farm.configured) byProduct.farm = usdValue(data.farm.totalStaked, t.LPT, p);
  if (data.staking.configured) byProduct.staking = usdValue(data.staking.totalStaked, t.ABC, p);

  const values = Object.values(byProduct);
  return {
    byProduct,
    total: values.reduce((sum, value) => sum + (value ?? 0n), 0n),
    complete: values.every((value) => value !== null),
  };
}

/**
 * Simple (non-compounding) reward APR in basis points.
 *
 * @param {bigint} rewardPerTokenPerDay  reward base units (18 decimals) paid per whole staked token per day
 * @param {bigint|null} rewardPrice      18-decimal USD price of the reward token
 * @param {bigint|null} stakePrice       18-decimal USD price of the staked token
 * @returns {bigint|null}
 */
export function rewardAprBps(rewardPerTokenPerDay, rewardPrice, stakePrice) {
  if (rewardPerTokenPerDay === null || rewardPerTokenPerDay === undefined || !rewardPrice || !stakePrice) return null;
  return (rewardPerTokenPerDay * 365n * rewardPrice * 10_000n) / (WAD * stakePrice);
}

/**
 * How much more (positive) or less (negative) value a trade returns than it
 * costs, at oracle prices, in parts per million. Captures fees, price impact
 * and how far the pool's price sits from the oracle's.
 */
export function valueDeltaPpm(valueIn, valueOut) {
  if (valueIn === null || valueOut === null || !valueIn) return null;
  return Number(((valueOut - valueIn) * 1_000_000n) / valueIn);
}

/**
 * The oracle's exchange rate as an 18-decimal bigint: how many whole `quote`
 * tokens one whole `base` token is worth.
 */
export function oracleRate(base, quote, prices) {
  const basePrice = usablePrice(base, prices);
  const quotePrice = usablePrice(quote, prices);
  if (basePrice === null || quotePrice === null) return null;
  return (basePrice * WAD) / quotePrice;
}

/**
 * Deviation of a pool's spot price from the oracle rate, in ppm (positive:
 * the pool pays more `quote` per `base` than the oracle says it is worth).
 * Reserves are raw base units; decimals are normalised here.
 */
export function poolDeviationPpm(reserveBase, reserveQuote, base, quote, prices) {
  const rate = oracleRate(base, quote, prices);
  if (rate === null || !reserveBase || !reserveQuote) return null;
  const spot = (reserveQuote * 10n ** BigInt(base.decimals ?? 18) * WAD) / (reserveBase * 10n ** BigInt(quote.decimals ?? 18));
  return Number(((spot - rate) * 1_000_000n) / rate);
}
