import { EXPLORER_TX_BASE_URL } from "../../contracts/contractConfig";
import { formatAmount } from "../../utils/format";

/**
 * The outcome of the swap you just confirmed.
 *
 *   input / output        from the Swap event in the transaction receipt
 *   reserves before       read during the pre-swap check, just before signing
 *   reserves after        from the Sync event, and re-read with getReserves()
 *   wallet after          re-read with balanceOf() once the receipt arrived
 *
 * Nothing here is computed from a quote: if a value could not be read it
 * shows "—".
 */
export default function SwapResultCard({ result, meta, onDismiss }) {
  const { A, B } = meta;
  const tokenIn = meta[result.inSide];
  const tokenOut = meta[result.outSide];
  const fmt = (raw, token) => `${formatAmount(raw, token.decimals, 6)} ${token.symbol}`;

  const k = (rA, rB) => (rA === null || rA === undefined || rB === null || rB === undefined ? null : rA * rB);
  const kBefore = k(result.reservesBefore.reserveA, result.reservesBefore.reserveB);
  const kAfter = k(result.after?.reserveA, result.after?.reserveB);

  return (
    <section className="panel result-card">
      <div className="panel-head">
        <h2>Last Swap — confirmed</h2>
        <button type="button" className="banner-close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>

      <div className="result-flow">
        <span className="result-amount">{fmt(result.amountIn, tokenIn)}</span>
        <span aria-hidden="true">→</span>
        <span className="result-amount accent">{fmt(result.amountOut, tokenOut)}</span>
      </div>

      <dl className="kv">
        <div>
          <dt>Transaction</dt>
          <dd className="mono">
            <a href={`${EXPLORER_TX_BASE_URL}${result.hash}`} target="_blank" rel="noreferrer">
              {result.hash} ↗
            </a>
            <span className="dd-note">block {result.block}</span>
          </dd>
        </div>
        <div>
          <dt>Simulated just before signing</dt>
          <dd>
            {fmt(result.quotedAtSend, tokenOut)}
            <span className="dd-note">
              {result.quotedAtSend === result.amountOut
                ? "received exactly the simulated amount"
                : "reserves moved between simulation and mining"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Reserves before</dt>
          <dd>
            {fmt(result.reservesBefore.reserveA, A)} / {fmt(result.reservesBefore.reserveB, B)}
          </dd>
        </div>
        <div>
          <dt>Reserves after</dt>
          <dd>
            {result.after ? `${fmt(result.after.reserveA, A)} / ${fmt(result.after.reserveB, B)}` : "—"}
            <span className="dd-note">getReserves() after confirmation</span>
          </dd>
        </div>
        <div>
          <dt>Your wallet after</dt>
          <dd>
            {result.after ? `${fmt(result.after.balanceA, A)} · ${fmt(result.after.balanceB, B)}` : "—"}
          </dd>
        </div>
        <div>
          <dt>k = reserveA × reserveB</dt>
          <dd>
            {kBefore !== null && kAfter !== null ? (
              <>
                {kAfter >= kBefore ? "did not decrease" : "DECREASED"}
                <span className="dd-note">
                  +{(kAfter - kBefore).toString()} raw units (integer rounding only — no fee)
                </span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
