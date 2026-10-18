import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";
import { PAIR_KEYS } from "./dex";
import { applySlippage, estimateBurn, estimateLiquidity, optimalAmounts, quote } from "./dexMath";

const MIN_TOLERANCE_BPS = 50; // minimum amounts = 99.5 % of the expected amounts

/**
 * Router.addLiquidity / Router.removeLiquidity for any of the three pools.
 *
 * Add: the Router creates the pair if needed and takes only the amounts that
 * keep the pool ratio (the sheet's scenario 9: 500 A + 3,000 B desired into a
 * 1:4 pool uses 500 A + 2,000 B). The preview shows exactly what it will take
 * and the LP it will mint, and the minimums are those amounts less 0.5 %.
 *
 * Remove: approve the Router for your LP tokens (the Pair's ERC-20), then burn
 * them for your pro-rata share of both reserves.
 */
export default function DexLiquidityPanel({ tokens, pairs, symbols, onApprove, onApproveLp, onAdd, onRemove, disabled, busy, pendingAction }) {
  const [pairKey, setPairKey] = useState("AB");
  const [mode, setMode] = useState("add");
  const [amountX, setAmountX] = useState("");
  const [amountY, setAmountY] = useState("");
  const [matchRatio, setMatchRatio] = useState(true);
  const [lpAmount, setLpAmount] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState("20");
  const [localError, setLocalError] = useState("");

  const pair = pairs[pairKey];
  const { x, y } = pair;
  const tx = tokens[x];
  const ty = tokens[y];
  const funded = Boolean(pair.address) && pair.reserveX > 0n && pair.reserveY > 0n;

  const parsedX = useMemo(() => parseAmount(amountX, tx.decimals), [amountX, tx.decimals]);
  const parsedY = useMemo(() => parseAmount(amountY, ty.decimals), [amountY, ty.decimals]);
  const parsedLp = useMemo(() => parseAmount(lpAmount, 18), [lpAmount]);
  const minutes = Number(deadlineMinutes);

  const reset = () => {
    setAmountX("");
    setAmountY("");
    setLpAmount("");
    setLocalError("");
  };

  /** Typing one side fills the other at the pool ratio. */
  const edit = (side, text) => {
    setLocalError("");
    const [setThis, setOther, tokThis, tokOther, rThis, rOther] =
      side === "x"
        ? [setAmountX, setAmountY, tx, ty, pair.reserveX, pair.reserveY]
        : [setAmountY, setAmountX, ty, tx, pair.reserveY, pair.reserveX];
    setThis(text);
    if (!matchRatio || !funded) return;
    const parsed = parseAmount(text, tokThis.decimals);
    const paired = parsed.ok ? quote(parsed.value, rThis, rOther) : null;
    if (paired !== null) setOther(toExactString(paired, tokOther.decimals));
  };

  // ---- add preview ----
  const used =
    parsedX.ok && parsedY.ok ? optimalAmounts(parsedX.value, parsedY.value, pair.reserveX ?? 0n, pair.reserveY ?? 0n) : null;
  const lpOut = used ? estimateLiquidity(used.amountA, used.amountB, pair.reserveX, pair.reserveY, pair.supply ?? 0n) : null;
  const minX = used ? applySlippage(used.amountA, funded ? MIN_TOLERANCE_BPS : 0) : null;
  const minY = used ? applySlippage(used.amountB, funded ? MIN_TOLERANCE_BPS : 0) : null;
  const needsX = parsedX.ok && tx.allowance !== null && tx.allowance < parsedX.value;
  const needsY = parsedY.ok && ty.allowance !== null && ty.allowance < parsedY.value;

  // ---- remove preview ----
  const burn = parsedLp.ok && funded ? estimateBurn(parsedLp.value, pair.reserveX, pair.reserveY, pair.supply) : null;
  const lpExceeds = parsedLp.ok && pair.lpBalance !== null && parsedLp.value > pair.lpBalance;
  const needsLp = parsedLp.ok && pair.lpAllowance !== null && pair.lpAllowance < parsedLp.value;

  const addProblem = () => {
    if (!parsedX.ok) return `${symbols[x]}: ${parsedX.error}`;
    if (!parsedY.ok) return `${symbols[y]}: ${parsedY.error}`;
    if (tx.balance !== null && used.amountA > tx.balance) return `You hold only ${formatAmount(tx.balance, tx.decimals, 4)} ${symbols[x]}.`;
    if (ty.balance !== null && used.amountB > ty.balance) return `You hold only ${formatAmount(ty.balance, ty.decimals, 4)} ${symbols[y]}.`;
    if (!lpOut) return "That deposit is too small to mint LP tokens (the first deposit must exceed the 1,000 locked base units).";
    if (!(minutes > 0)) return "Deadline must be a positive number of minutes.";
    return "";
  };

  const handleAdd = async () => {
    const message = addProblem() || (needsX || needsY ? "Approve both tokens for these amounts first." : "");
    setLocalError(message);
    if (message) return;
    if (await onAdd({ x, y, amountX: parsedX.value, amountY: parsedY.value, minX, minY, deadlineMinutes: minutes })) reset();
  };

  const handleRemove = async () => {
    let message = "";
    if (!parsedLp.ok) message = parsedLp.error;
    else if (lpExceeds) message = `You hold only ${formatAmount(pair.lpBalance, 18, 6)} LP.`;
    else if (!burn || burn.amountA === 0n || burn.amountB === 0n) message = "That LP amount is too small to return both tokens.";
    else if (needsLp) message = "Approve the Router for these LP tokens first.";
    setLocalError(message);
    if (message) return;
    const ok = await onRemove({
      x,
      y,
      liquidity: parsedLp.value,
      minX: applySlippage(burn.amountA, MIN_TOLERANCE_BPS),
      minY: applySlippage(burn.amountB, MIN_TOLERANCE_BPS),
      deadlineMinutes: minutes,
    });
    if (ok) reset();
  };

  const field = (side, token, value) => (
    <label className="field">
      <span className="field-label">
        {symbols[side === "x" ? x : y]} desired
        <span className="field-hint">
          you hold {formatAmount(token.balance, token.decimals, 4)} · approved {formatAmount(token.allowance, token.decimals, 4)}
        </span>
      </span>
      <div className="input-wrap">
        <input type="text" inputMode="decimal" placeholder={side === "x" ? "1000" : "4000"} value={value} onChange={(e) => edit(side, e.target.value)} disabled={disabled || busy} />
        <span className="input-suffix">{symbols[side === "x" ? x : y]}</span>
      </div>
    </label>
  );

  const stepButton = (num, needs, label, doneLabel, action, onClick, enabled, primary = false) => (
    <div className="step">
      <span className={`step-num ${needs ? "active" : enabled ? "done" : ""}`}>{num}</span>
      <button
        type="button"
        className={`btn ${primary ? "btn-primary" : "btn-outline"} btn-block`}
        onClick={onClick}
        disabled={disabled || busy || !enabled || (!primary && !needs)}
      >
        {pendingAction === action ? "Waiting..." : !primary && !needs && enabled ? doneLabel : label}
      </button>
    </div>
  );

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Liquidity</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> Router.{mode === "add" ? "addLiquidity" : "removeLiquidity"}
        </span>
      </div>

      <div className="tabs" role="tablist" aria-label="Pool">
        {PAIR_KEYS.map(({ key, x: px, y: py }) => (
          <button key={key} type="button" role="tab" aria-selected={pairKey === key} className={`tab ${pairKey === key ? "active" : ""}`} onClick={() => { setPairKey(key); reset(); }} disabled={busy}>
            {symbols[px]} / {symbols[py]}
            {!pairs[key].address && " (new)"}
          </button>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="Action">
        {["add", "remove"].map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`tab ${mode === m ? "active" : ""}`} onClick={() => { setMode(m); reset(); }} disabled={busy}>
            {m === "add" ? "Add liquidity" : "Remove liquidity"}
          </button>
        ))}
      </div>

      <p className="card-sub">
        {!pair.address
          ? `No ${symbols[x]}/${symbols[y]} pair yet — the Router creates it on your first deposit, and you set the starting price. You receive √(${symbols[x]}·${symbols[y]}) − 1,000 LP base units.`
          : funded
            ? `Pool: ${formatAmount(pair.reserveX, tx.decimals, 4)} ${symbols[x]} / ${formatAmount(pair.reserveY, ty.decimals, 4)} ${symbols[y]} · your LP ${formatAmount(pair.lpBalance, 18, 6)} of ${formatAmount(pair.supply, 18, 6)}.`
            : "The pair exists but is empty — the next deposit sets the price."}
      </p>

      {mode === "add" ? (
        <div className="form">
          {field("x", tx, amountX)}
          {field("y", ty, amountY)}
          {funded && (
            <label className="check-row">
              <input type="checkbox" checked={matchRatio} onChange={(e) => setMatchRatio(e.target.checked)} disabled={disabled || busy} />
              Fill the other side at the pool ratio
            </label>
          )}
          <div className="preview-line">
            {used && lpOut !== null ? (
              <>
                <span className="preview-label">Router will use</span>
                <span className="preview-value">
                  {formatAmount(used.amountA, tx.decimals, 6)} {symbols[x]} + {formatAmount(used.amountB, ty.decimals, 6)} {symbols[y]} → {formatAmount(lpOut, 18, 6)} LP
                </span>
                <span className="preview-src">
                  {funded ? `ratio kept with quote(); minimums ${MIN_TOLERANCE_BPS / 100}% below` : "first deposit: √(x·y) − 1000"}
                </span>
              </>
            ) : (
              <span className="preview-idle">Enter both amounts to see what the Router will take.</span>
            )}
          </div>
          {used && parsedY.ok && used.amountB < parsedY.value && (
            <p className="inline-warn">
              Off-ratio: only {formatAmount(used.amountB, ty.decimals, 6)} of your {amountY} {symbols[y]} will be used.
            </p>
          )}
          {used && parsedX.ok && used.amountA < parsedX.value && (
            <p className="inline-warn">
              Off-ratio: only {formatAmount(used.amountA, tx.decimals, 6)} of your {amountX} {symbols[x]} will be used.
            </p>
          )}
          <label className="field">
            <span className="field-label">Deadline</span>
            <div className="input-wrap">
              <input type="text" inputMode="decimal" value={deadlineMinutes} onChange={(e) => setDeadlineMinutes(e.target.value)} disabled={disabled || busy} />
              <span className="input-suffix">minutes</span>
            </div>
          </label>
          <div className="step-actions step-actions-3">
            {stepButton(1, needsX, `Approve ${symbols[x]}`, `${symbols[x]} approved ✓`, `approve-${x}`, () => onApprove(x, parsedX.value, { steps: [`Approve ${symbols[x]}`, `Approve ${symbols[y]}`, "Add liquidity"], activeStep: 0 }), parsedX.ok)}
            {stepButton(2, needsY, `Approve ${symbols[y]}`, `${symbols[y]} approved ✓`, `approve-${y}`, () => onApprove(y, parsedY.value, { steps: [`Approve ${symbols[x]}`, `Approve ${symbols[y]}`, "Add liquidity"], activeStep: 1 }), parsedY.ok)}
            {stepButton(3, false, "Add liquidity", "", "add", handleAdd, parsedX.ok && parsedY.ok && !needsX && !needsY, true)}
          </div>
        </div>
      ) : (
        <div className="form">
          <label className="field">
            <span className="field-label">
              LP tokens to burn
              <span className="field-hint">
                you hold {formatAmount(pair.lpBalance, 18, 6)} · approved {formatAmount(pair.lpAllowance, 18, 6)}
              </span>
            </span>
            <div className="input-wrap">
              <input type="text" inputMode="decimal" placeholder="500" value={lpAmount} onChange={(e) => { setLpAmount(e.target.value); setLocalError(""); }} disabled={disabled || busy || !pair.lpBalance} />
              <span className="input-suffix">LP</span>
              <button type="button" className="btn-max" onClick={() => setLpAmount(toExactString(pair.lpBalance, 18))} disabled={disabled || busy || !pair.lpBalance}>
                Max
              </button>
            </div>
          </label>
          <div className="preview-line">
            {burn && !lpExceeds ? (
              <>
                <span className="preview-label">Estimated return</span>
                <span className="preview-value">
                  {formatAmount(burn.amountA, tx.decimals, 6)} {symbols[x]} + {formatAmount(burn.amountB, ty.decimals, 6)} {symbols[y]}
                </span>
                <span className="preview-src">LP × reserve ÷ supply; minimums {MIN_TOLERANCE_BPS / 100}% below</span>
              </>
            ) : (
              <span className="preview-idle">
                {!pair.lpBalance ? "You hold no LP tokens for this pool." : lpExceeds ? "That is more LP than you hold." : "Enter an LP amount to see what you would receive."}
              </span>
            )}
          </div>
          <label className="field">
            <span className="field-label">Deadline</span>
            <div className="input-wrap">
              <input type="text" inputMode="decimal" value={deadlineMinutes} onChange={(e) => setDeadlineMinutes(e.target.value)} disabled={disabled || busy} />
              <span className="input-suffix">minutes</span>
            </div>
          </label>
          <div className="step-actions">
            {stepButton(1, needsLp, "Approve LP", "LP approved ✓", `approve-lp-${pairKey}`, () => onApproveLp(pairKey, parsedLp.value), parsedLp.ok && !lpExceeds)}
            {stepButton(2, false, "Remove liquidity", "", "remove", handleRemove, parsedLp.ok && !lpExceeds && !needsLp, true)}
          </div>
        </div>
      )}

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
