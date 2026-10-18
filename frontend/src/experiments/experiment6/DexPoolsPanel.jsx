import { EXPLORER_ADDRESS_BASE_URL } from "../../contracts/contractConfig";
import { formatAmount, shortAddress } from "../../utils/format";
import { PAIR_KEYS } from "./dex";

/**
 * Every possible pool among the three demo tokens, found through
 * Factory.getPair — LIVE reserves, LP supply, your LP balance and share, k,
 * and the spot price. A pool that does not exist yet can be created here with
 * Factory.createPair (or will be created by the Router on the first
 * addLiquidity).
 */
export default function DexPoolsPanel({ tokens, pairs, symbols, loading, lastRead, onRefresh, onCreatePair, disabled, busy, pendingAction }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pools</h2>
        <span className="panel-note">
          <span className="kind kind-read">live</span>
          {lastRead ? `block ${lastRead.block} · ${new Date(lastRead.at).toLocaleTimeString()}` : "not read yet"}
          <button type="button" className="btn btn-outline btn-inline" onClick={onRefresh} disabled={disabled || loading}>
            {loading ? "Reading..." : "Refresh"}
          </button>
        </span>
      </div>

      <div className="activity-scroll">
        <table className="activity">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Pair address</th>
              <th>Reserves</th>
              <th>Spot price</th>
              <th>k = x · y (base units)</th>
              <th>LP supply</th>
              <th>Your LP (share)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {PAIR_KEYS.map(({ key, x, y }) => {
              const p = pairs[key];
              const dx = tokens[x].decimals;
              const dy = tokens[y].decimals;
              const exists = Boolean(p.address);
              const funded = exists && p.reserveX > 0n && p.reserveY > 0n;
              const share =
                exists && p.supply > 0n && p.lpBalance !== null
                  ? `${(Number((p.lpBalance * 1_000_000n) / p.supply) / 10_000).toFixed(2)} %`
                  : "—";
              return (
                <tr key={key}>
                  <td>
                    <strong>
                      {symbols[x]} / {symbols[y]}
                    </strong>
                  </td>
                  <td className="mono">
                    {exists ? (
                      <a href={`${EXPLORER_ADDRESS_BASE_URL}${p.address}`} target="_blank" rel="noreferrer">
                        {shortAddress(p.address)} ↗
                      </a>
                    ) : (
                      "not created"
                    )}
                  </td>
                  <td>
                    {exists
                      ? `${formatAmount(p.reserveX, dx, 4)} ${symbols[x]} / ${formatAmount(p.reserveY, dy, 4)} ${symbols[y]}`
                      : "—"}
                  </td>
                  <td>
                    {funded
                      ? `1 ${symbols[x]} = ${(Number(p.reserveY) / Number(p.reserveX)).toPrecision(6)} ${symbols[y]}`
                      : exists
                        ? "empty pool"
                        : "—"}
                  </td>
                  <td className="mono">{funded ? (p.reserveX * p.reserveY).toString() : "—"}</td>
                  <td>{exists ? formatAmount(p.supply, 18, 6) : "—"}</td>
                  <td>{exists ? `${formatAmount(p.lpBalance, 18, 6)} (${share})` : "—"}</td>
                  <td>
                    {!exists && (
                      <button
                        type="button"
                        className="btn btn-outline btn-inline"
                        onClick={() => onCreatePair(x, y)}
                        disabled={disabled || busy}
                      >
                        {pendingAction === `create-${key}` ? "Creating..." : "Create pair"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="card-sub">
        Spot price is reserveY ÷ reserveX — the rate of an infinitesimal trade; real swaps move the reserves and pay
        the 0.3 % fee. k grows after every swap because the fee stays in the pool. The first 1,000 LP base units of
        every pool are locked at 0x…dEaD and count in the supply.
      </p>
    </section>
  );
}
