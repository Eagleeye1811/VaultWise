import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";

/**
 * withdraw(amount) on the farm / unstake(amount) on the staking contract —
 * a partial (or full) return of the staked token.
 *
 * It never pays rewards and never needs funding, so a stake can always be
 * recovered. The reward earned so far is checkpointed into pendingReward and
 * stays claimable; the stake that remains keeps earning at its smaller size.
 */
export default function WithdrawPanel({ pool, meta, data, onWithdraw, disabled, busy, pendingAction }) {
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  const { stake } = meta;
  const parsed = useMemo(() => parseAmount(amount, stake.decimals), [amount, stake.decimals]);
  const exceeds = parsed.ok && data.staked !== null && parsed.value > data.staked;
  const nothingStaked = data.staked === 0n;
  const fnName = pool.fn.withdraw;

  const handle = async () => {
    if (!parsed.ok) return setLocalError(parsed.error);
    if (exceeds)
      return setLocalError(`You have only ${formatAmount(data.staked, stake.decimals, 4)} ${stake.symbol} staked.`);
    setLocalError("");
    if (await onWithdraw(parsed.value)) setAmount("");
  };

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>
          {pool.verb.withdraw} {stake.symbol}
        </h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> {fnName}(amount)
        </span>
      </div>

      <p className="card-sub">
        Return part of your stake to your wallet. Rewards earned so far stay pending — {pool.verb.claim.toLowerCase()}{" "}
        them separately or use exit(). Suggested lab value: 40 {stake.symbol}, leaving 60 staked.
      </p>

      <div className="form">
        <label className="field">
          <span className="field-label">
            Amount to {pool.verb.withdraw.toLowerCase()}
            <span className="field-hint">
              staked {formatAmount(data.staked, stake.decimals, 4)} {stake.symbol}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="40"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setLocalError("");
              }}
              disabled={disabled || busy || nothingStaked}
            />
            <span className="input-suffix">{stake.symbol}</span>
            <button
              type="button"
              className="btn-max"
              onClick={() => setAmount(toExactString(data.staked, stake.decimals))}
              disabled={disabled || busy || !data.staked}
            >
              Max
            </button>
          </div>
        </label>

        <div className="preview-line">
          {parsed.ok && !exceeds && data.staked !== null ? (
            <>
              <span className="preview-label">Remaining stake</span>
              <span className="preview-value">
                {formatAmount(data.staked - parsed.value, stake.decimals, 4)} {stake.symbol}
              </span>
              <span className="preview-src">stakedBalance − amount</span>
            </>
          ) : (
            <span className="preview-idle">
              {nothingStaked
                ? `You have nothing staked in the ${pool.noun}.`
                : exceeds
                  ? `That is more than your ${formatAmount(data.staked, stake.decimals, 4)} ${stake.symbol} stake.`
                  : "Enter an amount to see what stays staked."}
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handle}
          disabled={disabled || busy || !parsed.ok || exceeds || nothingStaked}
        >
          {pendingAction === "withdraw" ? (
            <>
              <span className="spinner" aria-hidden="true" /> {pool.verb.withdrawing}...
            </>
          ) : (
            `${pool.verb.withdraw} ${stake.symbol}`
          )}
        </button>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
