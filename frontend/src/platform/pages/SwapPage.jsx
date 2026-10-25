import { useMemo, useState } from "react";

import { AMM_ADDRESS, DEX_ROUTER_ABI, DEX_ROUTER_ADDRESS, SIMPLE_AMM_ABI, isAmmConfigured, isDexConfigured } from "../../contracts/contractConfig";
import { applySlippage, findRoutes, getAmountsOut } from "../../experiments/experiment6/dexMath";
import { TOKEN_KEYS } from "../../experiments/experiment6/dex";
import { toExactString } from "../../utils/format";
import { approveStep, chainDeadline, checkAmount, useTradeSettings, writeContract } from "../actions";
import { fmtPpm, fmtRate, fmtToken, fmtUsd } from "../format";
import { oracleRate, poolDeviationPpm, usdValue, valueDeltaPpm } from "../pricing";
import { usePlatform } from "../usePlatform";
import { DEX_TOKEN_ID } from "../registry";
import SettingsPopover from "../SettingsPopover";
import { ActionButton, AmountField, Badge, Card, CompositionBar, EmptyState, Icon, Notice, PageHeader, Row, Skeleton, Tabs, TokenIcon, TokenPair, TokenSelect } from "../ui";

/**
 * Swap — the DEX router (Experiment 6) with automatic best-route selection,
 * plus the classic no-fee TKA/TKB pool (Experiment 4) as a second venue.
 * With the PriceOracle deployed, every quote is also checked against the
 * Chainlink reference prices.
 */

const WAD = 10n ** 18n;

const KEY_OF_ID = Object.fromEntries(Object.entries(DEX_TOKEN_ID).map(([key, id]) => [id, key]));

/** SimpleAMM._quote: no fee, ceil on the new out-reserve. */
function classicQuote(amountIn, reserveIn, reserveOut) {
  if (!amountIn || !reserveIn || !reserveOut) return null;
  const newIn = reserveIn + amountIn;
  const newOut = (reserveIn * reserveOut + newIn - 1n) / newIn;
  const out = reserveOut - newOut;
  return out > 0n ? out : null;
}

/** Impact in ppm: how far the execution rate is below the product of spot rates along the route. */
function routeImpactPpm(amountIn, amountOut, hops) {
  let spot = amountIn;
  for (const [rIn, rOut] of hops) {
    if (!rIn) return null;
    spot = (spot * rOut) / rIn;
  }
  if (!spot || !amountOut) return null;
  return spot > amountOut ? Number(((spot - amountOut) * 1_000_000n) / spot) : 0;
}

function impactTone(ppm) {
  if (ppm === null) return "neutral";
  if (ppm < 10_000) return "good";
  if (ppm < 50_000) return "warn";
  return "bad";
}

/** A trade that returns more value than it costs is fine; losses grade like price impact. */
const valueTone = (ppm) => (ppm === null ? "neutral" : ppm >= 0 ? "good" : impactTone(-ppm));

/** Oracle price and how far the pool's spot price sits from it. */
function OracleRows({ pool, prices }) {
  const rate = oracleRate(pool.a, pool.b, prices);
  if (rate === null) return null;
  const deviation = poolDeviationPpm(pool.ra, pool.rb, pool.a, pool.b, prices);
  return (
    <>
      <Row label="Oracle price">
        1 {pool.a.symbol} = {fmtRate(rate, 18, WAD, 18)} {pool.b.symbol}
      </Row>
      {deviation !== null && (
        <Row label="Pool vs oracle">
          <Badge tone={impactTone(Math.abs(deviation))} title="How far the pool's spot price is from the Chainlink reference rate">
            {fmtPpm(deviation)}
          </Badge>
        </Row>
      )}
    </>
  );
}

export default function SwapPage() {
  const { protocol, wallet, run } = usePlatform();
  const data = protocol.data;
  const [venue, setVenue] = useState(isDexConfigured || !isAmmConfigured ? "dex" : "classic");
  const [settings, setSettings] = useTradeSettings();
  const [fromId, setFromId] = useState("DXA");
  const [toId, setToId] = useState("DXB");
  const [classicAtoB, setClassicAtoB] = useState(true);
  const [amount, setAmount] = useState("");

  const tokens = useMemo(() => data?.tokens ?? {}, [data]);
  const isDex = venue === "dex";
  const from = isDex ? tokens[fromId] : tokens[classicAtoB ? "TKA" : "TKB"];
  const to = isDex ? tokens[toId] : tokens[classicAtoB ? "TKB" : "TKA"];
  const dexOptions = Object.values(DEX_TOKEN_ID).map((id) => tokens[id]).filter(Boolean);

  const { value: amountIn, error: amountError } = checkAmount(amount, from, wallet.account ? from?.balance : null);

  /* ── quote ───────────────────────────────────────────────────────── */
  const quote = useMemo(() => {
    if (!data || !from || !to) return null;
    if (isDex) {
      const pairs = Object.values(data.dex.pairs);
      const reservesOf = (x, y) => {
        const p = pairs.find((pp) => (pp.x === x && pp.y === y) || (pp.x === y && pp.y === x));
        if (!p?.address || !p.reserveX || !p.reserveY) return null;
        return p.x === x ? [p.reserveX, p.reserveY] : [p.reserveY, p.reserveX];
      };
      const fromKey = KEY_OF_ID[from.id];
      const toKey = KEY_OF_ID[to.id];
      const routes = findRoutes(fromKey, toKey, TOKEN_KEYS, (x, y) => reservesOf(x, y) !== null);
      if (routes.length === 0) return { noRoute: true };
      if (!amountIn) return { routes, path: routes[0] };
      let best = null;
      for (const path of routes) {
        const amounts = getAmountsOut(amountIn, path, reservesOf);
        if (amounts && (!best || amounts.at(-1) > best.out)) best = { path, amounts, out: amounts.at(-1) };
      }
      if (!best) return { routes, path: routes[0] };
      const hops = best.path.slice(1).map((y, i) => reservesOf(best.path[i], y));
      return { ...best, routes, impact: routeImpactPpm(amountIn, best.out, hops), minOut: applySlippage(best.out, settings.slippageBps) };
    }
    const { reserveA, reserveB } = data.amm;
    const [rIn, rOut] = classicAtoB ? [reserveA, reserveB] : [reserveB, reserveA];
    if (!rIn || !rOut) return { noRoute: true };
    if (!amountIn) return { path: null };
    const out = classicQuote(amountIn, rIn, rOut);
    return { out, impact: routeImpactPpm(amountIn, out, [[rIn, rOut]]), path: null };
  }, [data, from, to, isDex, amountIn, classicAtoB, settings.slippageBps]);

  /* ── the same trade at oracle prices ─────────────────────────────── */
  const prices = data?.oracleConfigured ? data.prices : null;
  const refRate = prices && from && to ? oracleRate(from, to, prices) : null;
  const valueIn = prices && amountIn ? usdValue(amountIn, from, prices) : null;
  const valueOut = prices && quote?.out ? usdValue(quote.out, to, prices) : null;
  const valueDelta = valueDeltaPpm(valueIn, valueOut);

  const flip = () => {
    if (isDex) {
      setFromId(toId);
      setToId(fromId);
    } else setClassicAtoB((v) => !v);
    setAmount(quote?.out ? toExactString(quote.out, to.decimals) : "");
  };

  const selectFrom = (id) => {
    if (id === toId) setToId(fromId);
    setFromId(id);
  };
  const selectTo = (id) => {
    if (id === fromId) setFromId(toId);
    setToId(id);
  };

  /* ── send ────────────────────────────────────────────────────────── */
  const swap = async () => {
    const ok = isDex
      ? await run({
          key: "swap",
          title: `Swap ${from.symbol} → ${to.symbol}`,
          steps: [
            approveStep(from, DEX_ROUTER_ADDRESS, amountIn, data.dex.allowances[KEY_OF_ID[from.id]], { spenderName: "Router" }),
            {
              label: `Swap ${fmtToken(amountIn, from.decimals)} ${from.symbol} for ${to.symbol}`,
              send: async () => {
                const router = await writeContract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI);
                const path = quote.path.map((k) => tokens[DEX_TOKEN_ID[k]].address);
                return router.swapExactTokensForTokens(amountIn, quote.minOut, path, wallet.account, await chainDeadline(settings.deadlineMinutes));
              },
            },
          ],
        })
      : await run({
          key: "swap",
          title: `Swap ${from.symbol} → ${to.symbol}`,
          steps: [
            approveStep(from, AMM_ADDRESS, amountIn, classicAtoB ? data.amm.allowanceA : data.amm.allowanceB, { spenderName: "pool" }),
            {
              label: `Swap ${fmtToken(amountIn, from.decimals)} ${from.symbol} for ${to.symbol}`,
              send: async () => {
                const amm = await writeContract(AMM_ADDRESS, SIMPLE_AMM_ABI);
                return classicAtoB ? amm.swapAForB(amountIn) : amm.swapBForA(amountIn);
              },
            },
          ],
        });
    if (ok) setAmount("");
  };

  const disabledReason =
    !amount ? "Enter an amount" : amountError ? amountError : quote?.noRoute ? "No liquidity for this pair" : !quote?.out ? "Amount too small" : "";

  const configured = isDex ? isDexConfigured : isAmmConfigured;
  const pathSymbols = quote?.path?.map((k) => tokens[DEX_TOKEN_ID[k]]?.symbol) ?? [from?.symbol, to?.symbol];

  /* ── market panel: the pool(s) behind the current pair ───────────── */
  const marketPools = useMemo(() => {
    if (!data || !from || !to) return [];
    if (!isDex) return [{ label: "TKA / TKB", a: tokens.TKA, b: tokens.TKB, ra: data.amm.reserveA, rb: data.amm.reserveB, fee: "0%" }];
    const path = quote?.path ?? [KEY_OF_ID[from.id], KEY_OF_ID[to.id]];
    return path.slice(1).map((y, i) => {
      const x = path[i];
      const p = Object.values(data.dex.pairs).find((pp) => (pp.x === x && pp.y === y) || (pp.x === y && pp.y === x));
      const a = tokens[DEX_TOKEN_ID[x]];
      const b = tokens[DEX_TOKEN_ID[y]];
      const [ra, rb] = p?.address ? (p.x === x ? [p.reserveX, p.reserveY] : [p.reserveY, p.reserveX]) : [0n, 0n];
      return { label: `${a.symbol} / ${b.symbol}`, a, b, ra, rb, fee: "0.3%", missing: !p?.address };
    });
  }, [data, from, to, isDex, quote, tokens]);

  return (
    <>
      <PageHeader title="Swap" subtitle="Trade instantly against on-chain liquidity. Best route is found automatically." />
      <div className="vw-swap-layout">
        <Card
          className="vw-swap-card"
          title={
            <Tabs
              size="sm"
              value={venue}
              onChange={(v) => {
                setVenue(v);
                setAmount("");
              }}
              options={[
                { value: "dex", label: "DEX · 0.3%" },
                { value: "classic", label: "Classic · 0%" },
              ]}
            />
          }
          actions={isDex && <SettingsPopover settings={settings} onChange={setSettings} />}
        >
          {!data ? (
            <div className="vw-stack">
              <Skeleton height="96px" />
              <Skeleton height="96px" />
            </div>
          ) : !configured || !from || !to ? (
            <EmptyState icon="swap" title="This venue is not deployed">
              Add its contract addresses to <code>frontend/.env</code> and restart the dev server.
            </EmptyState>
          ) : (
            <>
              <AmountField
                label="You pay"
                value={amount}
                onChange={setAmount}
                token={from}
                balance={wallet.account ? from.balance : undefined}
                error={amountError}
                tokenSlot={isDex ? <TokenSelect value={from.id} options={dexOptions} onChange={selectFrom} label="Token to sell" /> : undefined}
              />
              <div className="vw-flip-wrap">
                <button type="button" className="vw-flip" onClick={flip} aria-label="Switch direction">
                  <Icon name="arrowDown" />
                </button>
              </div>
              <AmountField
                label="You receive"
                value={quote?.out ? fmtToken(quote.out, to.decimals, { compact: false }) : ""}
                onChange={() => {}}
                readOnly
                token={to}
                balance={wallet.account ? to.balance : undefined}
                tokenSlot={isDex ? <TokenSelect value={to.id} options={dexOptions} onChange={selectTo} label="Token to buy" /> : undefined}
              />

              {quote?.out && (
                <div className="vw-details">
                  <Row label="Rate">
                    1 {from.symbol} = {fmtRate(quote.out, to.decimals, amountIn, from.decimals)} {to.symbol}
                  </Row>
                  {refRate !== null && (
                    <Row label="Oracle rate">
                      1 {from.symbol} = {fmtRate(refRate, 18, WAD, 18)} {to.symbol}
                    </Row>
                  )}
                  {valueDelta !== null && (
                    <Row label="Value at oracle prices">
                      {fmtUsd(valueIn)} → {fmtUsd(valueOut)}{" "}
                      <Badge tone={valueTone(valueDelta)} title="What you receive versus what you pay, both at Chainlink prices">
                        {fmtPpm(valueDelta)}
                      </Badge>
                    </Row>
                  )}
                  {isDex && (
                    <Row label="Route">
                      <span className="vw-route">
                        {pathSymbols.map((s, i) => (
                          <span key={`${s}-${i}`}>
                            {i > 0 && <Icon name="chevron" size={12} />}
                            {s}
                          </span>
                        ))}
                      </span>
                    </Row>
                  )}
                  <Row label="Price impact">
                    <Badge tone={impactTone(quote.impact)}>{quote.impact === null ? "—" : `${(quote.impact / 10_000).toFixed(2)}%`}</Badge>
                  </Row>
                  {isDex ? (
                    <>
                      <Row label={`Minimum received (${settings.slippageBps / 100}% slippage)`}>
                        {fmtToken(quote.minOut, to.decimals)} {to.symbol}
                      </Row>
                      <Row label="Liquidity provider fee">
                        0.3% × {quote.path.length - 1} hop{quote.path.length > 2 ? "s" : ""}
                      </Row>
                    </>
                  ) : (
                    <Row label="Fee">None</Row>
                  )}
                </div>
              )}

              {!isDex && quote?.out && (
                <Notice tone="warn">The classic pool has no minimum-output check: if the price moves before your swap is mined, you receive the new price.</Notice>
              )}
              {quote?.impact > 50_000 && <Notice tone="error">This trade moves the price by more than 5%. Consider a smaller amount.</Notice>}
              {valueDelta !== null && valueDelta < -50_000 && (
                <Notice tone="warn">
                  At Chainlink prices you receive {fmtPpm(valueDelta).slice(1)} less value than you pay. The pool&apos;s price is away from the
                  reference price, or the trade is large for the pool.
                </Notice>
              )}

              <ActionButton label="Swap" flowKey="swap" onClick={swap} disabledReason={disabledReason} configured={configured} />
            </>
          )}
        </Card>

        <div className="vw-stack">
          <Card title="Market" subtitle={isDex ? "Pools used by this route" : "Constant-product pool, no fee"}>
            {!data ? (
              <Skeleton height="80px" />
            ) : marketPools.length === 0 ? (
              <p className="vw-muted">Select two tokens.</p>
            ) : (
              <div className="vw-stack">
                {marketPools.map((pool) => (
                  <div key={pool.label} className="vw-market">
                    <div className="vw-market-head">
                      <TokenPair a={pool.a} b={pool.b} size={24} />
                      <strong>{pool.label}</strong>
                      <Badge>{pool.fee} fee</Badge>
                    </div>
                    {pool.missing ? (
                      <p className="vw-muted">No pool yet — create it on the Pools page.</p>
                    ) : (
                      <>
                        <Row label="Spot price">
                          1 {pool.a.symbol} = {fmtRate(pool.rb, pool.b.decimals, pool.ra, pool.a.decimals)} {pool.b.symbol}
                        </Row>
                        <Row label="Reserves">
                          {fmtToken(pool.ra, pool.a.decimals)} {pool.a.symbol} · {fmtToken(pool.rb, pool.b.decimals)} {pool.b.symbol}
                        </Row>
                        {prices && <OracleRows pool={pool} prices={prices} />}
                        <CompositionBar left={pool.ra} right={pool.rb} leftLabel={pool.a.symbol} rightLabel={pool.b.symbol} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Your balances">
            {!wallet.account ? (
              <p className="vw-muted">Connect a wallet to see balances.</p>
            ) : (
              <ul className="vw-balance-list">
                {(isDex ? dexOptions : [tokens.TKA, tokens.TKB].filter(Boolean)).map((t) => (
                  <li key={t.id}>
                    <TokenIcon token={t} size={24} />
                    <span>{t.symbol}</span>
                    <strong>{fmtToken(t.balance, t.decimals)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <a className="vw-link" href="#/faucet">
              Need test tokens? Open the faucet <Icon name="chevron" size={12} />
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}
