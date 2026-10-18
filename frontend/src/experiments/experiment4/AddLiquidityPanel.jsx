import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";
import { estimateLpShares, matchingAmount } from "./ammMath";

/**
 * addLiquidity(amountA, amountB) — a three-step flow:
 *
 *   1. approve(pool, amountA) on Token A     (skipped if already approved)
 *   2. approve(pool, amountB) on Token B     (skipped if already approved)
 *   3. addLiquidity(amountA, amountB)
 *
 * Approvals are for the exact deposit amounts, and the Add button stays
 * disabled until both live allowances cover them.
 *
 * Once the pool has liquidity, later deposits are credited at
 * `min(amountA/reserveA, amountB/reserveB) * supply`: anything above the pool
 * ratio on one side is accepted but earns no extra shares. "Match pool ratio"
 * (on by default) fills in the other side from the live reserves so that does
 * not happen by accident.
 */
export default function AddLiquidityPanel({
  meta,
  data,
  onApprove,
  onAdd,
  disabled,
  busy,
  pendingAction,
}) {
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [matchRatio, setMatchRatio] = useState(true);
  const [localError, setLocalError] = useState("");

  const { A, B, lp } = meta;
  const { reserveA, reserveB, supply, balanceA, balanceB, allowanceA, allowanceB } = data;
  const poolEmpty = supply === 0n;
  const canMatch = matchRatio && reserveA > 0n && reserveB > 0n;

  const parsedA = useMemo(() => parseAmount(amountA, A.decimals), [amountA, A.decimals]);
  const parsedB = useMemo(() => parseAmount(amountB, B.decimals), [amountB, B.decimals]);
  const bothValid = parsedA.ok && parsedB.ok;

  /** Typing one side fills the other at the current reserve ratio. */
  const editSide = (side, text) => {
    setLocalError("");
    const [setThis, setOther] = side === "A" ? [setAmountA, setAmountB] : [setAmountB, setAmountA];
    setThis(text);
    if (!canMatch) return;

    const parsed = parseAmount(text, meta[side].decimals);
    if (!parsed.ok) return;
    const [rIn, rOut, otherSide] =
      side === "A" ? [reserveA, reserveB, "B"] : [reserveB, reserveA, "A"];
    const paired = matchingAmount(parsed.value, rIn, rOut);
    if (paired !== null) setOther(toExactString(paired, meta[otherSide].decimals));
  };

  const estimate =
    bothValid && supply !== null
      ? estimateLpShares(parsedA.value, parsedB.value, reserveA, reserveB, supply)
      : null;

  // Off-ratio check: the shares each side alone would justify.
  let offRatio = false;
  if (bothValid && !poolEmpty && supply !== null && reserveA > 0n && reserveB > 0n) {
    const fromA = (parsedA.value * supply) / reserveA;
    const fromB = (parsedB.value * supply) / reserveB;
    const [hi, lo] = fromA > fromB ? [fromA, fromB] : [fromB, fromA];
    offRatio = hi - lo > hi / 1000n; // more than 0.1% apart
  }

  const needsA = parsedA.ok && allowanceA !== null && allowanceA < parsedA.value;
  const needsB = parsedB.ok && allowanceB !== null && allowanceB < parsedB.value;

  /** @returns {string} an error message, or "" when the inputs are usable. */
  const problem = () => {
    if (!parsedA.ok) return `${A.symbol}: ${parsedA.error}`;
    if (!parsedB.ok) return `${B.symbol}: ${parsedB.error}`;
    if (balanceA !== null && parsedA.value > balanceA)
      return `You hold only ${formatAmount(balanceA, A.decimals, 4)} ${A.symbol}.`;
    if (balanceB !== null && parsedB.value > balanceB)
      return `You hold only ${formatAmount(balanceB, B.decimals, 4)} ${B.symbol}.`;
    if (estimate === 0n) return "That deposit is too small to mint any LP shares.";
    return "";
  };

  const validate = () => {
    const message = problem();
    setLocalError(message);
    return message === "";
  };

  const steps = [`Approve ${A.symbol}`, `Approve ${B.symbol}`, "Add liquidity"];

  const handleApprove = async (side) => {
    if (!validate()) return;
    await onApprove(side, side === "A" ? parsedA.value : parsedB.value, {
      steps,
      activeStep: side === "A" ? 0 : 1,
    });
  };

  const handleAdd = async () => {
    if (!validate()) return;
    if (needsA || needsB) {
      setLocalError("Approve both tokens for these amounts first.");
      return;
    }
    if (await onAdd(parsedA.value, parsedB.value)) {
      setAmountA("");
      setAmountB("");
    }
  };

  const approveButton = (side, needs, parsed) => (
    <div className="step">
      <span className={`step-num ${needs ? "active" : "done"}`}>{side === "A" ? 1 : 2}</span>
      <button
        type="button"
        className="btn btn-outline btn-block"
        onClick={() => handleApprove(side)}
        disabled={disabled || busy || !parsed.ok || !needs}
      >
        {pendingAction === `approve-${side}` ? (
          <>
            <span className="spinner dark" aria-hidden="true" /> Approving...
          </>
        ) : needs || !parsed.ok ? (
          `Approve ${meta[side].symbol}`
        ) : (
          `${meta[side].symbol} approved ✓`
        )}
      </button>
    </div>
  );

  const field = (side, value, balance, allowance) => (
    <label className="field">
      <span className="field-label">
        {meta[side].symbol} amount
        <span className="field-hint">
          you hold {formatAmount(balance, meta[side].decimals, 4)} · approved{" "}
          {formatAmount(allowance, meta[side].decimals, 4)}
        </span>
      </span>
      <div className="input-wrap">
        <input
          type="text"
          inputMode="decimal"
          placeholder={side === "A" ? "1000" : "4000"}
          value={value}
          onChange={(event) => editSide(side, event.target.value)}
          disabled={disabled || busy}
        />
        <span className="input-suffix">{meta[side].symbol}</span>
        <button
          type="button"
          className="btn-max"
          onClick={() => editSide(side, toExactString(balance, meta[side].decimals))}
          disabled={disabled || busy || balance === null}
        >
          Max
        </button>
      </div>
    </label>
  );

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Add Liquidity</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> addLiquidity(amountA, amountB)
        </span>
      </div>

      <p className="card-sub">
        {poolEmpty
          ? `The pool is empty: you set the starting price. LP shares = √(${A.symbol} × ${B.symbol}).`
          : `Pool reserves: ${formatAmount(reserveA, A.decimals, 4)} ${A.symbol} / ${formatAmount(reserveB, B.decimals, 4)} ${B.symbol}. Deposit at this ratio to be credited in full.`}
      </p>

      <div className="form">
        {field("A", amountA, balanceA, allowanceA)}
        {field("B", amountB, balanceB, allowanceB)}

        {!poolEmpty && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={matchRatio}
              onChange={(event) => setMatchRatio(event.target.checked)}
              disabled={disabled || busy}
            />
            Match pool ratio automatically
          </label>
        )}

        <div className="preview-line">
          {estimate !== null ? (
            <>
              <span className="preview-label">Estimated LP shares</span>
              <span className="preview-value">
                {formatAmount(estimate, lp.decimals, 4)} {lp.symbol}
              </span>
              <span className="preview-src">
                {poolEmpty ? "√(a × b)" : "min(a·S/rA, b·S/rB)"} at current reserves
              </span>
            </>
          ) : (
            <span className="preview-idle">Enter both amounts to estimate your LP shares.</span>
          )}
        </div>

        {offRatio && (
          <p className="inline-warn">
            These amounts are off the pool ratio. You are credited only for the smaller side; the
            excess still enters the pool and benefits existing LPs.
          </p>
        )}

        <div className="step-actions step-actions-3">
          {approveButton("A", needsA, parsedA)}
          {approveButton("B", needsB, parsedB)}
          <div className="step">
            <span className={`step-num ${bothValid && !needsA && !needsB ? "active" : ""}`}>3</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleAdd}
              disabled={disabled || busy || !bothValid || needsA || needsB}
            >
              {pendingAction === "add" ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Adding...
                </>
              ) : (
                "Add Liquidity"
              )}
            </button>
          </div>
        </div>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
