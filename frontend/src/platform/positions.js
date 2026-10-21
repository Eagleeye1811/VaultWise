import { estimateBurn } from "../experiments/experiment6/dexMath";
import { estimateRemoval } from "../experiments/experiment4/ammMath";
import { DEX_TOKEN_ID } from "./registry";

/**
 * Every position the connected account holds across all products, derived
 * from one protocol snapshot. Shared by the Overview and Portfolio pages.
 *
 * Each position lists what it is worth in its underlying tokens — there is no
 * price oracle yet (that is Experiment 7), so nothing is converted to USD.
 *
 * @returns {{ id, product, name, route, kind, holdings: { token, raw }[], pending?: { token, raw } }[]}
 */
export function derivePositions(data) {
  if (!data?.account) return [];
  const t = data.tokens;
  const out = [];
  const ETH = { symbol: "ETH", decimals: 18, hue: "#4a5785" };

  if (data.ethVault.mine > 0n)
    out.push({ id: "ethVault", product: "ETH Savings Vault", kind: "Vault", route: "earn", holdings: [{ token: ETH, raw: data.ethVault.mine }] });

  if (data.vault4626.shares > 0n && t.USDC)
    out.push({
      id: "vault4626",
      product: "Core USDC Vault",
      kind: "Vault",
      route: "earn",
      holdings: [{ token: t.USDC, raw: data.vault4626.shareValue }],
    });

  if (data.amm.lp > 0n && t.TKA && t.TKB) {
    const { amountA, amountB } = estimateRemoval(data.amm.lp, data.amm.reserveA, data.amm.reserveB, data.amm.supply);
    out.push({
      id: "amm",
      product: "Classic TKA/TKB pool",
      kind: "Liquidity",
      route: "pools",
      holdings: [
        { token: t.TKA, raw: amountA },
        { token: t.TKB, raw: amountB },
      ],
    });
  }

  for (const p of Object.values(data.dex.pairs ?? {})) {
    if (!(p.lp > 0n)) continue;
    const a = t[DEX_TOKEN_ID[p.x]];
    const b = t[DEX_TOKEN_ID[p.y]];
    const burn = estimateBurn(p.lp, p.reserveX, p.reserveY, p.supply);
    out.push({
      id: `dex-${p.key}`,
      product: `${a.symbol}/${b.symbol} DEX pool`,
      kind: "Liquidity",
      route: "pools",
      holdings: [
        { token: a, raw: burn?.amountA ?? null },
        { token: b, raw: burn?.amountB ?? null },
      ],
    });
  }

  for (const [key, stakeId, rewardId, name] of [
    ["farm", "LPT", "RWD_F", "LPT Yield Farm"],
    ["staking", "ABC", "RWD_S", "ABC Staking"],
  ]) {
    const p = data[key];
    if (!p.configured || !(p.staked > 0n || p.earned > 0n)) continue;
    out.push({
      id: key,
      product: name,
      kind: key === "farm" ? "Farm" : "Staking",
      route: "earn",
      holdings: [{ token: t[stakeId], raw: p.staked }],
      pending: { token: t[rewardId], raw: p.earned },
    });
  }

  return out;
}
