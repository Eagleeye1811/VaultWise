import StatCard from "../../components/StatCard";
import { formatAmount } from "../../utils/format";
import { formatDuration, fundingRunwaySeconds, rewardPerSecond } from "./rewardMath";

/**
 * The position at a glance. Every value except "Projected now" and the
 * runway is a LIVE read pinned to one block, whose number is shown so a stale
 * snapshot is visible as such.
 *
 * "Projected now" ticks every second between reads using the contract's own
 * formula (stake × rate × seconds since the read). It is labelled as a
 * calculation: the harvest/claim pays whatever the contract computes at the
 * block it is mined in.
 */
export default function PositionStats({ pool, meta, data, projected, loading, lastRead, onRefresh, disabled }) {
  const { stake, reward } = meta;
  const perSecond = rewardPerSecond(data.staked, data.rate, data.precision);
  const runway = fundingRunwaySeconds(data.rewardBalance, data.totalStaked, data.rate, data.precision);
  const rateText =
    data.rate !== null && data.precision !== null
      ? `${formatAmount((data.rate * 10n ** BigInt(reward.decimals)) / data.precision, reward.decimals, 3)} ${reward.symbol} per ${stake.symbol} per second`
      : "—";

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{pool.title} — your position</h2>
        <span className="panel-note">
          <span className="kind kind-read">live</span>
          {lastRead ? `block ${lastRead.block} · ${new Date(lastRead.at).toLocaleTimeString()}` : "not read yet"}
          <button type="button" className="btn btn-outline btn-inline" onClick={onRefresh} disabled={disabled || loading}>
            {loading ? "Reading..." : "Refresh"}
          </button>
        </span>
      </div>

      <div className="stats-grid stats-grid-3">
        <StatCard
          label="Your Stake"
          value={formatAmount(data.staked, stake.decimals, 4)}
          unit={stake.symbol}
          hint={`stakedBalance(you) in ${pool.contractName}`}
          loading={loading}
          accent
        />
        <StatCard
          label="Earned (on-chain)"
          value={formatAmount(data.earned, reward.decimals, 6)}
          unit={reward.symbol}
          hint={
            lastRead
              ? `earned(you) at block ${lastRead.block} · checkpointed pendingReward ${formatAmount(data.pending, reward.decimals, 6)}`
              : "earned(you)"
          }
          loading={loading}
        />
        <StatCard
          label="Projected now"
          value={formatAmount(projected, reward.decimals, 6)}
          unit={reward.symbol}
          hint={
            perSecond !== null && perSecond > 0n
              ? `calculated · +${formatAmount(perSecond, reward.decimals, 4)} ${reward.symbol}/s at your stake`
              : "calculated · nothing staked, nothing accruing"
          }
          loading={loading}
        />
        <StatCard
          label="Reward Rate"
          value={data.rate !== null ? data.rate.toString() : "—"}
          unit="base units"
          hint={`rewardRate() ÷ ${data.precision !== null ? data.precision.toString() : "1e18"} = ${rateText}`}
          loading={loading}
        />
        <StatCard
          label={`Total ${stake.symbol} Staked`}
          value={formatAmount(data.totalStaked, stake.decimals, 4)}
          unit={stake.symbol}
          hint="totalStaked() — every user's stake in this contract"
          loading={loading}
        />
        <StatCard
          label={`${pool.contractName} ${reward.symbol} Funding`}
          value={formatAmount(data.rewardBalance, reward.decimals, 4)}
          unit={reward.symbol}
          hint={
            runway !== null
              ? `estimated runway ≈ ${formatDuration(runway)} at the current total stake`
              : `RWD held by the ${pool.noun}; rewards are paid only from this`
          }
          loading={loading}
        />
      </div>
    </section>
  );
}
