import { EXPLORER_TX_BASE_URL } from "../../contracts/contractConfig";
import { shortAddress } from "../../utils/format";

/**
 * Every transaction confirmed on this screen during this visit, newest first,
 * with the amounts taken from each receipt's own events. It is the lab
 * evidence trail — stake, harvest/claim, partial withdrawal, exit — with real
 * hashes only. It is not persisted; reload and it starts empty.
 */
export default function SessionLog({ pool, entries }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Session Log — {pool.contractName}</h2>
        <span className="panel-note">
          <span className="kind kind-hist">receipts</span> confirmed this visit
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <p>
            Confirmed transactions appear here with their hashes — follow the sheet: approve → stake → wait →{" "}
            {pool.fn.claim}() → {pool.fn.withdraw}(40) → exit().
          </p>
        </div>
      ) : (
        <div className="activity-scroll">
          <table className="activity">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Amounts (from events)</th>
                <th>Block</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.hash}>
                  <td>{entry.at.toLocaleTimeString()}</td>
                  <td className="mono">{entry.action}</td>
                  <td>{entry.amounts.join(" · ")}</td>
                  <td className="mono">{entry.block}</td>
                  <td className="mono">
                    <a href={`${EXPLORER_TX_BASE_URL}${entry.hash}`} target="_blank" rel="noreferrer">
                      {shortAddress(entry.hash, 10, 6)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
