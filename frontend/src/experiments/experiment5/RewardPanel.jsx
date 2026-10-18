import { formatAmount } from "../../utils/format";
import { payoutProblem } from "./rewardMath";

/**
 * harvest() / claimReward() and exit().
 *
 * Both pay rewards, so both are checked against the pool's live RWD funding
 * before MetaMask opens: the contracts refuse to pay more than they hold, and
 * exit() is all-or-nothing. When the pool is short, the panel says so and
 * points at the stake-only withdrawal that still works.
 */
export default function RewardPanel({
  pool,
  meta,
  data,
  projected,
  onClaim,
  onExit,
  isRewardOwner,
  disabled,
  busy,
  pendingAction,
}) {
  const { stake, reward } = meta;
  const owed = projected ?? data.earned;
  const shortfall = payoutProblem({
    earned: owed,
    rewardBalance: data.rewardBalance,
    rewardSymbol: reward.symbol,
    noun: pool.noun,
    decimals: reward.decimals,
  });
  const nothingToClaim = data.earned === 0n && (projected === null || projected === 0n);
  const nothingToExit = data.staked === 0n && nothingToClaim;

  const spinner = (label, dark = false) => (
    <>
      <span className={`spinner ${dark ? "dark" : ""}`} aria-hidden="true" /> {label}
    </>
  );

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Rewards</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> {pool.fn.claim}() · exit()
        </span>
      </div>

      <div className="result-amount">
        {formatAmount(owed, reward.decimals, 6)} {reward.symbol}
      </div>
      <p className="card-sub">
        Accrued so far (projected to this second). Formula: <code>staked × 0.001 × seconds</code> — 100{" "}
        {stake.symbol} for 60 s earns 6 {reward.symbol}. The transaction pays the exact amount at the block it is mined
        in, usually a little more.
      </p>

      {shortfall && (
        <p className="inline-warn">
          {shortfall}
          {isRewardOwner && " You own RWD — use “Fund” in the wallet card."}
        </p>
      )}

      <div className="form">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={onClaim}
          disabled={disabled || busy || nothingToClaim || Boolean(shortfall)}
        >
          {pendingAction === "claim" ? spinner(`${pool.verb.claiming}...`) : `${pool.verb.claim} ${reward.symbol}`}
        </button>

        <div className="preview-line">
          <span className="preview-label">exit() would</span>
          <span className="preview-value">
            return {formatAmount(data.staked, stake.decimals, 4)} {stake.symbol} + pay ≈{" "}
            {formatAmount(owed, reward.decimals, 6)} {reward.symbol}
          </span>
          <span className="preview-src">whole stake + every pending reward, in one transaction</span>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-block"
          onClick={onExit}
          disabled={disabled || busy || nothingToExit || Boolean(shortfall)}
        >
          {pendingAction === "exit" ? spinner("Exiting...", true) : "Exit (withdraw all + claim)"}
        </button>
      </div>
    </section>
  );
}
