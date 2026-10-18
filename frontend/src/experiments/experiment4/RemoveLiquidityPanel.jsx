import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";
import { estimateRemoval } from "./ammMath";

/**
 * removeLiquidity(lpAmount) — burn LP shares, receive both tokens back.
 *
 * No approval is needed: the pool burns its own ERC-20 shares directly from
 * the caller. The estimate uses the contract's exact formula,
 * `lpAmount * reserve / totalSupply` (rounded down), on the reserves just read
 * from chain.
 */
export default function RemoveLiquidityPanel({ meta, data, onRemove, disabled, busy, pendingAction }) {
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  const { A, B, lp } = meta;
  const { lpBalance, reserveA, reserveB, supply } = data;

  const parsed = useMemo(() => parseAmount(amount, lp.decimals), [amount, lp.decimals]);
  const exceedsBalance = parsed.ok && lpBalance !== null && parsed.value > lpBalance;

  const estimate =
    parsed.ok && !exceedsBalance && supply !== null && supply > 0n
      ? estimateRemoval(parsed.value, reserveA, reserveB, supply)
      : null;
  const dust = estimate !== null && (estimate.amountA === 0n || estimate.amountB === 0n);

  const handleRemove = async () => {
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    if (exceedsBalance) {
      setLocalError(`You hold only ${formatAmount(lpBalance, lp.decimals, 4)} ${lp.symbol}.`);
      return;
    }
    if (dust) {
      setLocalError("That amount is too small — it would return 0 of one token.");
      return;
    }
    setLocalError("");
    if (await onRemove(parsed.value)) setAmount("");
  };

  const noShares = lpBalance === 0n;

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Remove Liquidity</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> removeLiquidity(lpAmount)
        </span>
      </div>

      <p className="card-sub">
        Burn {lp.symbol} to withdraw your proportional share of both reserves. No approval needed.
      </p>

      <div className="form">
        <label className="field">
          <span className="field-label">
            LP shares to burn
            <span className="field-hint">
              you hold {formatAmount(lpBalance, lp.decimals, 4)} {lp.symbol}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="500"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setLocalError("");
              }}
              disabled={disabled || busy || noShares}
            />
            <span className="input-suffix">{lp.symbol}</span>
            <button
              type="button"
              className="btn-max"
              onClick={() => setAmount(toExactString(lpBalance, lp.decimals))}
              disabled={disabled || busy || !lpBalance}
            >
              Max
            </button>
          </div>
        </label>

        <div className="preview-line">
          {estimate !== null ? (
            <>
              <span className="preview-label">Estimated return</span>
              <span className="preview-value">
                {formatAmount(estimate.amountA, A.decimals, 4)} {A.symbol} +{" "}
                {formatAmount(estimate.amountB, B.decimals, 4)} {B.symbol}
              </span>
              <span className="preview-src">lp × reserve / totalSupply at current reserves</span>
            </>
          ) : (
            <span className="preview-idle">
              {noShares
                ? `You hold no ${lp.symbol} yet — add liquidity first.`
                : exceedsBalance
                  ? `That is more than the ${formatAmount(lpBalance, lp.decimals, 4)} ${lp.symbol} you hold.`
                  : "Enter an amount to see what you would receive."}
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleRemove}
          disabled={disabled || busy || !parsed.ok || exceedsBalance || noShares}
        >
          {pendingAction === "remove" ? (
            <>
              <span className="spinner" aria-hidden="true" /> Removing...
            </>
          ) : (
            "Remove Liquidity"
          )}
        </button>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
