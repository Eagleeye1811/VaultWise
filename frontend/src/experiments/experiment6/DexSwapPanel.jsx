import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";
import { TOKEN_KEYS } from "./dex";
import { applySlippage, findRoutes, getAmountsOut, priceImpactPpm } from "./dexMath";

const TOLERANCES_BPS = [10, 50, 100, 300];

/**
 * swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline).
 *
 * - Routes: the direct pool and every route through the third token, each
 *   kept only if all its pools have liquidity; the best quote is preselected.
 * - Quotes are CALCULATED here from the live reserves with the Router's exact
 *   formula, then re-checked with Router.getAmountsOut just before signing.
 * - Minimum received comes from the slippage tolerance, or can be typed in.
 * - The deadline is measured from the chain's latest block time.
 */
export default function DexSwapPanel({ tokens, symbols, reservesOf, onApprove, onSwap, disabled, busy, pendingAction }) {
  const [from, setFrom] = useState("A");
  const [to, setTo] = useState("B");
  const [amount, setAmount] = useState("");
  const [routeIndex, setRouteIndex] = useState(-1); // -1 = best route
  const [toleranceBps, setToleranceBps] = useState(50);
  const [manualMin, setManualMin] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [localError, setLocalError] = useState("");

  const tokenIn = tokens[from];
  const tokenOut = tokens[to];
  const parsed = useMemo(() => parseAmount(amount, tokenIn.decimals), [amount, tokenIn.decimals]);

  const routes = useMemo(
    () =>
      findRoutes(from, to, TOKEN_KEYS, (x, y) => reservesOf(x, y) !== null).map((path) => ({
        path,
        amounts: parsed.ok ? getAmountsOut(parsed.value, path, reservesOf) : null,
      })),
    [from, to, parsed, reservesOf]
  );
  // Preselect the best route when nothing is chosen explicitly.
  const bestIndex = routes.reduce(
    (best, route, i) => (route.amounts && (!routes[best]?.amounts || route.amounts.at(-1) > routes[best].amounts.at(-1)) ? i : best),
    0
  );
  const selected = routes[routeIndex] ?? routes[bestIndex] ?? null;
  const expectedOut = selected?.amounts?.at(-1) ?? null;

  const manualParsed = manualMin.trim() === "" ? null : parseAmount(manualMin, tokenOut.decimals);
  const minOut = manualParsed?.ok ? manualParsed.value : applySlippage(expectedOut, toleranceBps);

  const impacts =
    selected?.amounts && selected.path.length > 1
      ? selected.path.slice(0, -1).map((x, i) => {
          const [rIn, rOut] = reservesOf(x, selected.path[i + 1]);
          return priceImpactPpm(selected.amounts[i], selected.amounts[i + 1], rIn, rOut);
        })
      : [];

  const exceedsBalance = parsed.ok && tokenIn.balance !== null && parsed.value > tokenIn.balance;
  const needsApproval = parsed.ok && tokenIn.allowance !== null && tokenIn.allowance < parsed.value;
  const minutes = Number(deadlineMinutes);
  const deadlineOk = Number.isFinite(minutes) && minutes > 0;

  const pick = (setter, value) => {
    setter(value);
    setRouteIndex(-1);
    setManualMin("");
    setLocalError("");
  };

  // Picking the token already on the other side swaps the two sides.
  const chooseFrom = (key) => {
    if (key === to) setTo(from);
    pick(setFrom, key);
  };
  const chooseTo = (key) => {
    if (key === from) setFrom(to);
    pick(setTo, key);
  };

  const problem = () => {
    if (!parsed.ok) return parsed.error;
    if (exceedsBalance) return `Your wallet holds only ${formatAmount(tokenIn.balance, tokenIn.decimals, 4)} ${symbols[from]}.`;
    if (!selected) return `No route from ${symbols[from]} to ${symbols[to]}: create a pool and add liquidity first.`;
    if (!expectedOut) return "That amount is too small to buy anything.";
    if (manualParsed && !manualParsed.ok) return `Minimum received: ${manualParsed.error}`;
    if (!deadlineOk) return "Deadline must be a positive number of minutes.";
    return "";
  };

  const handleApprove = async () => {
    const message = problem();
    setLocalError(message);
    if (!message) await onApprove(from, parsed.value, { steps: [`Approve ${symbols[from]}`, "Swap"], activeStep: 0 });
  };

  const handleSwap = async () => {
    const message = problem() || (needsApproval ? `Approve ${symbols[from]} for this amount first.` : "");
    setLocalError(message);
    if (message) return;
    if (await onSwap({ path: selected.path, amountIn: parsed.value, minOut, deadlineMinutes: minutes })) {
      setAmount("");
      setManualMin("");
    }
  };

  const tokenTabs = (value, onPick, label) => (
    <div className="tabs" role="tablist" aria-label={label}>
      {TOKEN_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={`tab ${value === key ? "active" : ""}`}
          onClick={() => onPick(key)}
          disabled={busy}
        >
          {label} {symbols[key]}
        </button>
      ))}
    </div>
  );

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Swap</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> swapExactTokensForTokens
        </span>
      </div>

      {tokenTabs(from, chooseFrom, "Sell")}
      {tokenTabs(to, chooseTo, "Buy")}

      <div className="form">
        <label className="field">
          <span className="field-label">
            Amount in
            <span className="field-hint">
              you hold {formatAmount(tokenIn.balance, tokenIn.decimals, 4)} · approved{" "}
              {formatAmount(tokenIn.allowance, tokenIn.decimals, 4)}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="100"
              value={amount}
              onChange={(event) => pick(setAmount, event.target.value)}
              disabled={disabled || busy}
            />
            <span className="input-suffix">{symbols[from]}</span>
            <button
              type="button"
              className="btn-max"
              onClick={() => pick(setAmount, toExactString(tokenIn.balance, tokenIn.decimals))}
              disabled={disabled || busy || !tokenIn.balance}
            >
              Max
            </button>
          </div>
        </label>

        {routes.length === 0 ? (
          <p className="inline-warn">
            No route from {symbols[from]} to {symbols[to]} — no pool with liquidity connects them. Add liquidity below.
          </p>
        ) : (
          <div className="form" role="radiogroup" aria-label="Route">
            {routes.map((route, i) => (
              <label key={route.path.join("")} className="check-row">
                <input
                  type="radio"
                  name="dex-route"
                  checked={selected === route}
                  onChange={() => setRouteIndex(i)}
                  disabled={busy}
                />
                {route.path.map((k) => symbols[k]).join(" → ")} {route.path.length > 2 ? "(multi-hop)" : "(direct)"}
                {route.amounts && (
                  <span className="field-hint">
                    → {route.amounts.slice(1).map((a, j) => `${formatAmount(a, tokens[route.path[j + 1]].decimals, 6)} ${symbols[route.path[j + 1]]}`).join(" → ")}
                    {i === bestIndex ? " · best" : ""}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        {expectedOut !== null && (
          <dl className="quote-grid">
            <div>
              <dt>Expected output</dt>
              <dd>
                {formatAmount(expectedOut, tokenOut.decimals, 6)} {symbols[to]}
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatAmount(minOut, tokenOut.decimals, 6)} {symbols[to]}
                {manualParsed?.ok ? " (manual)" : ` (${toleranceBps / 100}% tolerance)`}
              </dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd>{impacts.map((ppm) => (ppm === null ? "—" : `${(ppm / 10_000).toFixed(2)}%`)).join(" + ")} incl. 0.3% fee per hop</dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>0.3% of the input, per hop — stays in the pool</dd>
            </div>
          </dl>
        )}

        <div className="tolerance-row" role="group" aria-label="Slippage tolerance">
          <span className="field-label">Slippage tolerance</span>
          {TOLERANCES_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              className={`chip ${toleranceBps === bps && !manualParsed?.ok ? "active" : ""}`}
              onClick={() => {
                setToleranceBps(bps);
                setManualMin("");
              }}
              disabled={busy}
            >
              {bps / 100}%
            </button>
          ))}
        </div>

        <div className="cards-grid">
          <label className="field">
            <span className="field-label">Minimum received (amountOutMin)</span>
            <div className="input-wrap">
              <input
                type="text"
                inputMode="decimal"
                placeholder={expectedOut !== null ? toExactString(applySlippage(expectedOut, toleranceBps), tokenOut.decimals) : "auto"}
                value={manualMin}
                onChange={(event) => setManualMin(event.target.value)}
                disabled={disabled || busy}
              />
              <span className="input-suffix">{symbols[to]}</span>
            </div>
          </label>
          <label className="field">
            <span className="field-label">Deadline</span>
            <div className="input-wrap">
              <input
                type="text"
                inputMode="decimal"
                value={deadlineMinutes}
                onChange={(event) => setDeadlineMinutes(event.target.value)}
                disabled={disabled || busy}
              />
              <span className="input-suffix">minutes</span>
            </div>
          </label>
        </div>

        <p className="allowance-note">
          Output = in·997·reserveOut ÷ (reserveIn·1000 + in·997), rounded down, per hop. The Router reverts with
          INSUFFICIENT_OUTPUT_AMOUNT if the final output is below your minimum, and with EXPIRED after the deadline.
          The confirmed amounts are taken from the pools' Swap events.
        </p>

        <div className="step-actions">
          <div className="step">
            <span className={`step-num ${needsApproval ? "active" : parsed.ok ? "done" : ""}`}>1</span>
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={handleApprove}
              disabled={disabled || busy || !parsed.ok || !needsApproval}
            >
              {pendingAction === `approve-${from}` ? "Approving..." : needsApproval || !parsed.ok ? `Approve ${symbols[from]}` : `${symbols[from]} approved ✓`}
            </button>
          </div>
          <div className="step">
            <span className={`step-num ${parsed.ok && !needsApproval ? "active" : ""}`}>2</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleSwap}
              disabled={disabled || busy || !parsed.ok || needsApproval || !selected || exceedsBalance}
            >
              {pendingAction === "swap" ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Swapping...
                </>
              ) : (
                "Swap"
              )}
            </button>
          </div>
        </div>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
