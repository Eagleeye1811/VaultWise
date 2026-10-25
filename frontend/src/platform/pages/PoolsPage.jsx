import { useMemo, useState } from "react";

import { AMM_ADDRESS, DEX_ROUTER_ABI, DEX_ROUTER_ADDRESS, SIMPLE_AMM_ABI, isAmmConfigured, isDexConfigured } from "../../contracts/contractConfig";
import { applySlippage, estimateBurn, estimateLiquidity, optimalAmounts, quote as dexQuote } from "../../experiments/experiment6/dexMath";
import { estimateLpShares, estimateRemoval, matchingAmount } from "../../experiments/experiment4/ammMath";
import { toExactString } from "../../utils/format";
import { approveStep, chainDeadline, checkAmount, useTradeSettings, writeContract } from "../actions";
import { fmtPpm, fmtRate, fmtShare, fmtToken, fmtUsd } from "../format";
import { poolDeviationPpm, sumUsd, usdValue } from "../pricing";
import { usePlatform } from "../usePlatform";
import { DEX_TOKEN_ID } from "../registry";
import SettingsPopover from "../SettingsPopover";
import { ActionButton, AmountField, Badge, Card, CompositionBar, EmptyState, Icon, Notice, PageHeader, Row, Skeleton, Stat, Tabs, TokenPair } from "../ui";

/**
 * Pools — every liquidity pool on the platform in one table: the three
 * Factory/Router pairs (Experiment 6) and the classic TKA/TKB pool
 * (Experiment 4). Each row expands into add / remove liquidity.
 */

/** Normalise both pool kinds to one shape. */
function usePools(data) {
  return useMemo(() => {
    if (!data) return [];
    const t = data.tokens;
    const pools = [];
    if (isDexConfigured) {
      for (const p of Object.values(data.dex.pairs)) {
        const a = t[DEX_TOKEN_ID[p.x]];
        const b = t[DEX_TOKEN_ID[p.y]];
        if (!a || !b) continue;
        pools.push({
          id: `dex-${p.key}`,
          kind: "dex",
          a,
          b,
          ra: p.reserveX ?? 0n,
          rb: p.reserveY ?? 0n,
          supply: p.supply ?? 0n,
          lp: p.lp ?? null,
          exists: Boolean(p.address),
          pairAddress: p.address,
          allowanceA: data.dex.allowances[p.x],
          allowanceB: data.dex.allowances[p.y],
          lpAllowance: p.lpAllowance,
          fee: "0.3%",
          venue: "DEX",
        });
      }
    }
    if (isAmmConfigured && t.TKA && t.TKB) {
      pools.push({
        id: "classic",
        kind: "classic",
        a: t.TKA,
        b: t.TKB,
        ra: data.amm.reserveA ?? 0n,
        rb: data.amm.reserveB ?? 0n,
        supply: data.amm.supply ?? 0n,
        lp: data.amm.lp ?? null,
        exists: true,
        allowanceA: data.amm.allowanceA,
        allowanceB: data.amm.allowanceB,
        fee: "0%",
        venue: "Classic",
      });
    }
    // At oracle prices: the pool's value, and the deviation of its spot price from the oracle rate.
    if (data.oracleConfigured) {
      for (const pool of pools) {
        pool.tvl = pool.exists ? sumUsd([usdValue(pool.ra, pool.a, data.prices), usdValue(pool.rb, pool.b, data.prices)]) : null;
        pool.deviation = poolDeviationPpm(pool.ra, pool.rb, pool.a, pool.b, data.prices);
      }
    }
    return pools;
  }, [data]);
}

function AddLiquidity({ pool, settings }) {
  const { wallet, run } = usePlatform();
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const { a, b, ra, rb, supply } = pool;
  const hasReserves = ra > 0n && rb > 0n;
  const balA = wallet.account ? a.balance : null;
  const balB = wallet.account ? b.balance : null;

  const pairOf = (raw, rIn, rOut) => (pool.kind === "dex" ? dexQuote(raw, rIn, rOut) : matchingAmount(raw, rIn, rOut));

  // Typing one side fills the other at the pool ratio (an empty pool takes any ratio).
  const onA = (value) => {
    setAmountA(value);
    const v = checkAmount(value, a).value;
    if (hasReserves) setAmountB(v ? toExactString(pairOf(v, ra, rb) ?? 0n, b.decimals) : "");
  };
  const onB = (value) => {
    setAmountB(value);
    const v = checkAmount(value, b).value;
    if (hasReserves) setAmountA(v ? toExactString(pairOf(v, rb, ra) ?? 0n, a.decimals) : "");
  };

  const ca = checkAmount(amountA, a, balA);
  const cb = checkAmount(amountB, b, balB);

  const used = ca.value && cb.value ? (pool.kind === "dex" ? optimalAmounts(ca.value, cb.value, ra, rb) : { amountA: ca.value, amountB: cb.value }) : null;
  const lpOut = used
    ? pool.kind === "dex"
      ? estimateLiquidity(used.amountA, used.amountB, ra, rb, supply)
      : estimateLpShares(used.amountA, used.amountB, ra, rb, supply)
    : null;

  const spender = pool.kind === "dex" ? DEX_ROUTER_ADDRESS : AMM_ADDRESS;
  const flowKey = `add-${pool.id}`;

  const submit = async () => {
    const ok = await run({
      key: flowKey,
      title: `Add ${a.symbol}/${b.symbol} liquidity`,
      steps: [
        approveStep(a, spender, ca.value, pool.allowanceA),
        approveStep(b, spender, cb.value, pool.allowanceB),
        {
          label: pool.exists ? `Supply ${a.symbol} + ${b.symbol}` : `Create pool and supply`,
          send: async () => {
            if (pool.kind === "classic") return (await writeContract(AMM_ADDRESS, SIMPLE_AMM_ABI)).addLiquidity(ca.value, cb.value);
            const router = await writeContract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI);
            return router.addLiquidity(
              a.address,
              b.address,
              ca.value,
              cb.value,
              applySlippage(used.amountA, settings.slippageBps),
              applySlippage(used.amountB, settings.slippageBps),
              wallet.account,
              await chainDeadline(settings.deadlineMinutes)
            );
          },
        },
      ],
    });
    if (ok) {
      setAmountA("");
      setAmountB("");
    }
  };

  const disabledReason =
    !amountA || !amountB ? "Enter both amounts" : ca.error ? `${a.symbol}: ${ca.error}` : cb.error ? `${b.symbol}: ${cb.error}` : lpOut === 0n ? "Amount too small" : "";

  return (
    <div className="vw-stack">
      {!hasReserves && (
        <Notice tone="info">
          {pool.exists ? "This pool is empty." : "This pool does not exist yet."} You set the starting price: the ratio of the two
          amounts you supply.{pool.kind === "dex" && " 1,000 LP base units are locked forever on the first deposit."}
        </Notice>
      )}
      <AmountField label="Deposit" value={amountA} onChange={onA} token={a} balance={wallet.account ? a.balance : undefined} error={ca.error} />
      <div className="vw-plus">
        <Icon name="plus" size={16} />
      </div>
      <AmountField label="Deposit" value={amountB} onChange={onB} token={b} balance={wallet.account ? b.balance : undefined} error={cb.error} />
      {used && (
        <div className="vw-details">
          <Row label="LP tokens you receive (est.)">{fmtToken(lpOut, 18)}</Row>
          <Row label="Share of pool">{fmtShare(lpOut, supply + (lpOut ?? 0n))}</Row>
          {pool.kind === "dex" && hasReserves && (
            <Row label={`Minimums (${settings.slippageBps / 100}% slippage)`}>
              {fmtToken(applySlippage(used.amountA, settings.slippageBps), a.decimals)} {a.symbol} · {fmtToken(applySlippage(used.amountB, settings.slippageBps), b.decimals)} {b.symbol}
            </Row>
          )}
        </div>
      )}
      {pool.kind === "classic" && used && hasReserves && (
        <Notice tone="warn">The classic pool credits only the part of a deposit that matches its ratio — keep the pre-filled amounts.</Notice>
      )}
      <ActionButton label={pool.exists ? "Add liquidity" : "Create pool"} flowKey={flowKey} onClick={submit} disabledReason={disabledReason} />
    </div>
  );
}

function RemoveLiquidity({ pool, settings }) {
  const { wallet, run } = usePlatform();
  const [amount, setAmount] = useState("");
  const { a, b, ra, rb, supply, lp } = pool;
  const lpToken = { symbol: pool.kind === "dex" ? "VWDEX-LP" : "vwLP", decimals: 18, address: pool.pairAddress ?? AMM_ADDRESS };
  const c = checkAmount(amount, lpToken, lp, { overLabel: "More than your LP balance" });
  const out = c.value ? (pool.kind === "dex" ? estimateBurn(c.value, ra, rb, supply) : estimateRemoval(c.value, ra, rb, supply)) : null;
  const flowKey = `remove-${pool.id}`;

  if (!wallet.account || !lp) return <EmptyState icon="drop" title="No position in this pool">Add liquidity to start earning swap fees.</EmptyState>;

  const setPct = (pct) => setAmount(toExactString((lp * BigInt(pct)) / 100n, 18));

  const submit = async () => {
    const ok = await run({
      key: flowKey,
      title: `Remove ${a.symbol}/${b.symbol} liquidity`,
      steps:
        pool.kind === "dex"
          ? [
              approveStep(lpToken, DEX_ROUTER_ADDRESS, c.value, pool.lpAllowance),
              {
                label: `Withdraw ${a.symbol} + ${b.symbol}`,
                send: async () =>
                  (await writeContract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI)).removeLiquidity(
                    a.address,
                    b.address,
                    c.value,
                    applySlippage(out.amountA, settings.slippageBps),
                    applySlippage(out.amountB, settings.slippageBps),
                    wallet.account,
                    await chainDeadline(settings.deadlineMinutes)
                  ),
              },
            ]
          : [
              {
                label: `Withdraw ${a.symbol} + ${b.symbol}`,
                send: async () => (await writeContract(AMM_ADDRESS, SIMPLE_AMM_ABI)).removeLiquidity(c.value),
              },
            ],
    });
    if (ok) setAmount("");
  };

  const disabledReason = !amount ? "Enter an amount" : c.error ? c.error : out && (out.amountA === 0n || out.amountB === 0n) ? "Amount too small" : "";

  return (
    <div className="vw-stack">
      <AmountField label="LP tokens to burn" value={amount} onChange={setAmount} token={lpToken} balance={lp} error={c.error} />
      <div className="vw-chips">
        {[25, 50, 75, 100].map((pct) => (
          <button key={pct} type="button" onClick={() => setPct(pct)}>
            {pct === 100 ? "Max" : `${pct}%`}
          </button>
        ))}
      </div>
      {out && (
        <div className="vw-details">
          <Row label={`You receive ${a.symbol}`}>{fmtToken(out.amountA, a.decimals)}</Row>
          <Row label={`You receive ${b.symbol}`}>{fmtToken(out.amountB, b.decimals)}</Row>
        </div>
      )}
      <ActionButton label="Remove liquidity" flowKey={flowKey} onClick={submit} disabledReason={disabledReason} />
    </div>
  );
}

function PoolRow({ pool, open, onToggle, settings }) {
  const [tab, setTab] = useState("add");
  const { a, b, ra, rb, supply, lp } = pool;
  const position = lp && supply ? (pool.kind === "dex" ? estimateBurn(lp, ra, rb, supply) : estimateRemoval(lp, ra, rb, supply)) : null;

  return (
    <div className={`vw-pool ${open ? "open" : ""}`}>
      <button type="button" className="vw-pool-row" onClick={onToggle} aria-expanded={open}>
        <span className="vw-pool-name">
          <TokenPair a={a} b={b} />
          <span>
            <strong>
              {a.symbol} / {b.symbol}
            </strong>
            <small>
              <Badge>{pool.venue}</Badge> <Badge>{pool.fee} fee</Badge>
            </small>
          </span>
        </span>
        <span className="vw-pool-cell" data-label="Liquidity">
          {pool.exists ? (
            <>
              {pool.tvl !== undefined && <strong className="vw-block">{fmtUsd(pool.tvl)}</strong>}
              {fmtToken(ra, a.decimals)} {a.symbol}
              <br />
              {fmtToken(rb, b.decimals)} {b.symbol}
            </>
          ) : (
            <span className="vw-muted">Not created</span>
          )}
        </span>
        <span className="vw-pool-cell" data-label="Price">
          {ra && rb ? `1 ${a.symbol} = ${fmtRate(rb, b.decimals, ra, a.decimals)} ${b.symbol}` : "—"}
        </span>
        <span className="vw-pool-cell" data-label="Your share">
          {lp ? fmtShare(lp, supply) : "—"}
        </span>
        <span className="vw-pool-chev">
          <Icon name="chevron" className={open ? "vw-rot90" : ""} />
        </span>
      </button>
      {open && (
        <div className="vw-pool-body">
          <div className="vw-pool-info">
            {pool.exists && ra > 0n && <CompositionBar left={ra} right={rb} leftLabel={a.symbol} rightLabel={b.symbol} />}
            {pool.deviation !== undefined && pool.deviation !== null && (
              <Row label="Pool price vs oracle">
                <Badge tone={Math.abs(pool.deviation) < 10_000 ? "good" : Math.abs(pool.deviation) < 50_000 ? "warn" : "bad"}>{fmtPpm(pool.deviation)}</Badge>
              </Row>
            )}
            <Row label="LP supply">{fmtToken(supply, 18)}</Row>
            <Row label="Your LP tokens">{fmtToken(lp, 18)}</Row>
            {position && (
              <Row label="Your position">
                {fmtToken(position.amountA, a.decimals)} {a.symbol} + {fmtToken(position.amountB, b.decimals)} {b.symbol}
              </Row>
            )}
            <p className="vw-muted vw-small">
              {pool.kind === "dex"
                ? "Every swap pays 0.3% into the pool, so LP tokens redeem for slightly more over time."
                : "No-fee constant-product pool from Experiment 4 — liquidity earns nothing, it only enables swaps."}
            </p>
          </div>
          <div className="vw-pool-form">
            <Tabs value={tab} onChange={setTab} options={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }]} />
            {tab === "add" ? <AddLiquidity pool={pool} settings={settings} /> : <RemoveLiquidity pool={pool} settings={settings} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PoolsPage() {
  const { protocol, wallet } = usePlatform();
  const pools = usePools(protocol.data);
  const [openId, setOpenId] = useState(null);
  const [settings, setSettings] = useTradeSettings();

  const live = pools.filter((p) => p.exists && p.ra > 0n).length;
  const mine = pools.filter((p) => p.lp && p.lp > 0n).length;
  const priced = Boolean(protocol.data?.oracleConfigured);
  const totalTvl = priced ? pools.reduce((sum, p) => sum + (p.tvl ?? 0n), 0n) : null;

  return (
    <>
      <PageHeader
        title="Pools"
        subtitle="Provide liquidity to earn trading fees. Every number is read live from the pool contracts."
        actions={<SettingsPopover settings={settings} onChange={setSettings} />}
      />
      <div className="vw-stats-row">
        {priced && <Stat label="Total liquidity" value={fmtUsd(totalTvl)} sub="At oracle prices" />}
        <Stat label="Pools" value={pools.length} loading={!protocol.data} sub="DEX pairs + classic pool" />
        <Stat label="With liquidity" value={live} loading={!protocol.data} sub="Ready to trade" />
        <Stat label="Your positions" value={wallet.account ? mine : "—"} loading={!protocol.data && wallet.account} sub={wallet.account ? "Pools where you hold LP" : "Connect to see"} />
      </div>
      <Card padded={false}>
        <div className="vw-pool-header">
          <span>Pool</span>
          <span>Liquidity</span>
          <span>Price</span>
          <span>Your share</span>
          <span />
        </div>
        {!protocol.data ? (
          <div className="vw-pad vw-stack">
            <Skeleton height="56px" />
            <Skeleton height="56px" />
            <Skeleton height="56px" />
          </div>
        ) : pools.length === 0 ? (
          <EmptyState icon="drop" title="No pools deployed">
            Set the DEX or classic pool addresses in <code>frontend/.env</code>.
          </EmptyState>
        ) : (
          pools.map((pool) => (
            <PoolRow key={pool.id} pool={pool} settings={settings} open={openId === pool.id} onToggle={() => setOpenId(openId === pool.id ? null : pool.id)} />
          ))
        )}
      </Card>
    </>
  );
}
