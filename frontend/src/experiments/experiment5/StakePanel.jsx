import { useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";
import { rewardPerSecond } from "./rewardMath";

/**
 * stake(amount) — the sheet's two-step flow:
 *
 *   1. approve(pool, amount) on the staking token   (skipped if already approved)
 *   2. stake(amount)
 *
 * The approval is for the exact amount, and Stake stays disabled until the
 * live allowance covers it. Staking more on top of an existing stake first
 * checkpoints the reward earned so far, so nothing already accrued is lost.
 */
export default function StakePanel({ pool, meta, data, onApprove, onStake, disabled, busy, pendingAction }) {
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  const { stake, reward } = meta;
  const parsed = useMemo(() => parseAmount(amount, stake.decimals), [amount, stake.decimals]);
  const exceedsBalance = parsed.ok && data.walletStake !== null && parsed.value > data.walletStake;
  const needsApproval = parsed.ok && data.allowance !== null && data.allowance < parsed.value;
  const newPerSecond =
    parsed.ok && data.staked !== null ? rewardPerSecond(data.staked + parsed.value, data.rate, data.precision) : null;

  const problem = () => {
    if (!parsed.ok) return parsed.error;
    if (exceedsBalance)
      return `Your wallet holds only ${formatAmount(data.walletStake, stake.decimals, 4)} ${stake.symbol}.`;
    return "";
  };

  const handleApprove = async () => {
    const message = problem();
    setLocalError(message);
    if (!message) await onApprove(parsed.value);
  };

  const handleStake = async () => {
    const message = problem() || (needsApproval ? `Approve ${stake.symbol} for this amount first.` : "");
    setLocalError(message);
    if (!message && (await onStake(parsed.value))) setAmount("");
  };

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Stake {stake.symbol}</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> approve() → stake(amount)
        </span>
      </div>

      <p className="card-sub">
        Lock {stake.symbol} in {pool.contractName} to earn {reward.symbol} every second. Suggested lab value: 100{" "}
        {stake.symbol}.
      </p>

      <div className="form">
        <label className="field">
          <span className="field-label">
            Amount to stake
            <span className="field-hint">
              you hold {formatAmount(data.walletStake, stake.decimals, 4)} · approved{" "}
              {formatAmount(data.allowance, stake.decimals, 4)}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="100"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setLocalError("");
              }}
              disabled={disabled || busy}
            />
            <span className="input-suffix">{stake.symbol}</span>
            <button
              type="button"
              className="btn-max"
              onClick={() => setAmount(toExactString(data.walletStake, stake.decimals))}
              disabled={disabled || busy || !data.walletStake}
            >
              Max
            </button>
          </div>
        </label>

        <div className="preview-line">
          {newPerSecond !== null && !exceedsBalance ? (
            <>
              <span className="preview-label">Reward rate after staking</span>
              <span className="preview-value">
                {formatAmount(newPerSecond, reward.decimals, 4)} {reward.symbol}/s ·{" "}
                {formatAmount(newPerSecond * 60n, reward.decimals, 4)} per minute
              </span>
              <span className="preview-src">(staked + amount) × rewardRate ÷ 1e18</span>
            </>
          ) : (
            <span className="preview-idle">
              {exceedsBalance
                ? `That is more than the ${formatAmount(data.walletStake, stake.decimals, 4)} ${stake.symbol} in your wallet.`
                : data.walletStake === 0n
                  ? `Your wallet holds no ${stake.symbol}. Mint some first (token owner only).`
                  : "Enter an amount to see the reward rate it earns."}
            </span>
          )}
        </div>

        <div className="step-actions">
          <div className="step">
            <span className={`step-num ${needsApproval ? "active" : parsed.ok ? "done" : ""}`}>1</span>
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={handleApprove}
              disabled={disabled || busy || !parsed.ok || exceedsBalance || !needsApproval}
            >
              {pendingAction === "approve" ? (
                <>
                  <span className="spinner dark" aria-hidden="true" /> Approving...
                </>
              ) : needsApproval || !parsed.ok ? (
                `Approve ${stake.symbol}`
              ) : (
                `${stake.symbol} approved ✓`
              )}
            </button>
          </div>
          <div className="step">
            <span className={`step-num ${parsed.ok && !needsApproval && !exceedsBalance ? "active" : ""}`}>2</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleStake}
              disabled={disabled || busy || !parsed.ok || exceedsBalance || needsApproval}
            >
              {pendingAction === "stake" ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Staking...
                </>
              ) : (
                "Stake"
              )}
            </button>
          </div>
        </div>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
