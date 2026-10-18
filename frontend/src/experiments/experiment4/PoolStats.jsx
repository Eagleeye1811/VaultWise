import StatCard from "../../components/StatCard";
import { formatAmount } from "../../utils/format";
import { formatRatio, formatShare } from "./ammMath";

/**
 * The pool at a glance — all LIVE values read from the contracts: both
 * reserves, both spot exchange rates, pool composition, LP supply and your
 * position. The block number of the read is shown so a stale snapshot is
 * visible as such.
 *
 * The spot rate `reserveOut / reserveIn` is the marginal price of an
 * infinitesimal trade. A real swap moves the reserves and executes at a worse
 * average rate; the Swap panel shows the contract's quote for a given size.
 */
export default function PoolStats({ data, meta, loading, lastRead, onRefresh, disabled }) {
  const { A, B, lp } = meta;
  const known = data.reserveA !== null && data.reserveB !== null;
  const empty = known && (data.reserveA === 0n || data.reserveB === 0n);
  const total = known ? data.reserveA + data.reserveB : 0n;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pool Overview</h2>
        <span className="panel-note">
          <span className="kind kind-read">live</span>
          {lastRead ? `block ${lastRead.block} · ${lastRead.at.toLocaleTimeString()}` : "not read yet"}
          <button
            type="button"
            className="btn btn-outline btn-inline"
            onClick={onRefresh}
            disabled={disabled || loading}
          >
            {loading ? "Reading..." : "Refresh"}
          </button>
        </span>
      </div>

      <div className="stats-grid stats-grid-3">
        <StatCard
          label={`${A.symbol} Reserve`}
          value={formatAmount(data.reserveA, A.decimals, 4)}
          unit={A.symbol}
          hint="reserveA — Token A held by the pool (x)"
          loading={loading}
        />
        <StatCard
          label={`${B.symbol} Reserve`}
          value={formatAmount(data.reserveB, B.decimals, 4)}
          unit={B.symbol}
          hint="reserveB — Token B held by the pool (y)"
          loading={loading}
        />
        <StatCard
          label="Total LP Supply"
          value={formatAmount(data.supply, lp.decimals, 4)}
          unit={lp.symbol}
          hint="totalSupply() — every LP share in circulation"
          loading={loading}
        />
        <StatCard
          label={`1 ${A.symbol} =`}
          value={!known ? "—" : empty ? "Empty pool" : formatRatio(data.reserveB, B.decimals, data.reserveA, A.decimals, 6)}
          unit={known && !empty ? B.symbol : ""}
          hint="reserveB / reserveA — spot rate, not an execution price"
          loading={loading}
        />
        <StatCard
          label={`1 ${B.symbol} =`}
          value={!known ? "—" : empty ? "Empty pool" : formatRatio(data.reserveA, A.decimals, data.reserveB, B.decimals, 6)}
          unit={known && !empty ? A.symbol : ""}
          hint="reserveA / reserveB — spot rate, not an execution price"
          loading={loading}
        />
        <StatCard
          label="Your LP Shares"
          value={formatAmount(data.lpBalance, lp.decimals, 4)}
          unit={lp.symbol}
          hint={`balanceOf(you) · ${formatShare(data.lpBalance, data.supply)} of the pool`}
          loading={loading}
          accent
        />
      </div>

      {known && !empty && (
        <div className="composition" aria-label="Pool composition by token units">
          <div className="composition-bar">
            <span style={{ flexGrow: Number((data.reserveA * 10_000n) / total) }}>{A.symbol}</span>
            <span style={{ flexGrow: Number((data.reserveB * 10_000n) / total) }}>{B.symbol}</span>
          </div>
          <span className="composition-note">
            Composition by token units: {formatShare(data.reserveA, total)} {A.symbol} ·{" "}
            {formatShare(data.reserveB, total)} {B.symbol} (both 18 decimals). By value at the spot
            price, a constant-product pool is always 50 / 50.
          </span>
        </div>
      )}
    </section>
  );
}
