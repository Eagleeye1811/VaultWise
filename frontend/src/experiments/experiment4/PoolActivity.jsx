import { useCallback, useEffect, useState } from "react";

import { AMM_DEPLOY_BLOCK, EXPLORER_TX_BASE_URL, TOKEN_A_ADDRESS } from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { friendlyError } from "../../utils/errors";
import { formatAmount, shortAddress } from "../../utils/format";
import { getAmmRead } from "./contracts";

/**
 * Pool activity — HISTORICAL data from SimpleAMM's event logs
 * (LiquidityAdded, LiquidityRemoved, Swap). These rows describe past
 * transactions; the live pool state is in the overview above.
 *
 * Logs are read through the wallet's RPC in 10 000-block chunks from
 * VITE_AMM_DEPLOY_BLOCK (or the most recent 50 000 blocks if unset), and only
 * re-read after a confirmed transaction or on request — not on every poll.
 */

const CHUNK = 10_000;
const FALLBACK_WINDOW = 50_000;
const SHOW = 25;
const EVENTS = new Set(["LiquidityAdded", "LiquidityRemoved", "Swap"]);

export default function PoolActivity({ meta, ready, refreshKey, account }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState(null);

  const load = useCallback(async () => {
    if (!ready) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const provider = getProvider();
      const amm = getAmmRead(provider);
      const latest = await provider.getBlockNumber();
      const from = AMM_DEPLOY_BLOCK ?? Math.max(0, latest - FALLBACK_WINDOW);

      const logs = [];
      for (let start = from; start <= latest; start += CHUNK) {
        const chunk = await amm.queryFilter("*", start, Math.min(start + CHUNK - 1, latest));
        logs.push(...chunk.filter((log) => EVENTS.has(log.fragment?.name)));
      }
      logs.sort((x, y) => y.blockNumber - x.blockNumber || y.index - x.index);
      setRows(logs.slice(0, SHOW));
      setRange({ from, latest, total: logs.length });
      setError("");
    } catch (err) {
      setError(friendlyError(err, "Could not read the pool's event history."));
    } finally {
      setLoading(false);
    }
  }, [ready]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const { A, B, lp } = meta;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pool Activity</h2>
        <span className="panel-note">
          <span className="kind kind-hist">history</span> event logs
          {range && ` · blocks ${range.from}–${range.latest} · ${range.total} event(s)`}
          <button type="button" className="btn btn-outline btn-inline" onClick={load} disabled={!ready || loading}>
            {loading ? "Loading..." : "Reload"}
          </button>
        </span>
      </div>

      {error && <p className="inline-error">{error}</p>}

      {!error && rows.length === 0 && (
        <div className="empty">
          <p>{ready ? (loading ? "Reading event logs…" : "No pool activity in this block range yet.") : "Connect on Sepolia to load pool history."}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="activity-scroll">
          <table className="activity">
            <thead>
              <tr>
                <th>Block</th>
                <th>Event</th>
                <th>Account</th>
                <th>Details</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => {
                const name = log.fragment.name;
                const who = name === "Swap" ? log.args.trader : log.args.provider;
                return (
                  <tr key={`${log.transactionHash}-${log.index}`}>
                    <td>{log.blockNumber}</td>
                    <td>
                      <span className={`event-badge ${name === "Swap" ? "amm" : "erc20"}`}>{name}</span>
                    </td>
                    <td className="mono">
                      {shortAddress(who, 6, 4)}
                      {account && who.toLowerCase() === account.toLowerCase() && " (you)"}
                    </td>
                    <td>{detail(log, A, B, lp)}</td>
                    <td className="mono">
                      <a href={`${EXPLORER_TX_BASE_URL}${log.transactionHash}`} target="_blank" rel="noreferrer">
                        {shortAddress(log.transactionHash, 8, 4)} ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One line describing an event, using the amounts it carries. */
function detail(log, A, B, lp) {
  const a = log.args;
  const f = (raw, token) => `${formatAmount(raw, token.decimals, 4)} ${token.symbol}`;
  if (log.fragment.name === "Swap") {
    const [tokenIn, tokenOut] =
      a.tokenIn.toLowerCase() === TOKEN_A_ADDRESS.toLowerCase() ? [A, B] : [B, A];
    return `${f(a.amountIn, tokenIn)} → ${f(a.amountOut, tokenOut)}`;
  }
  const sign = log.fragment.name === "LiquidityAdded" ? "+" : "−";
  return `${sign}${f(a.amountA, A)} ${sign}${f(a.amountB, B)} · ${sign}${formatAmount(a.lpShares, lp.decimals, 4)} ${lp.symbol}`;
}
