import { formatUnits } from "ethers";

import { EXPLORER_TX_BASE_URL } from "../contracts/contractConfig";
import { shortAddress } from "../utils/format";

/**
 * The state of the most recent transaction, plus the events it emitted.
 *
 * `tx` shape (owned by `useTransaction`):
 *   { status: "idle" | "pending" | "confirmed" | "failed",
 *     hash: string | null,
 *     message: string,
 *     steps: [{ label, state }],
 *     events: [{ source, name, standard, args }] }
 *
 * The hash is never faked — it only appears once ethers returns a real one.
 *
 * The decoded event list is the UI's answer to "inspect the transaction logs
 * and identify the ERC-20 and ERC-4626 events": a deposit visibly emits a
 * MockUSDC `Transfer`, a vault-share `Transfer`, and the ERC-4626 `Deposit`.
 */

const LABELS = {
  idle: "No recent transaction",
  pending: "Transaction pending...",
  confirmed: "Transaction confirmed",
  failed: "Transaction failed",
};

/** Render one decoded event argument as readable text. */
function renderArg({ type, value }, decimals) {
  if (type === "address") return shortAddress(value, 6, 4);
  if (typeof value === "bigint") {
    if (decimals === null || decimals === undefined) return value.toString();
    return `${formatUnits(value, decimals)} (${value.toString()})`;
  }
  return String(value);
}

export default function TransactionStatus({ tx, decimals = null }) {
  const status = tx?.status ?? "idle";
  const steps = tx?.steps ?? [];
  const events = tx?.events ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Transaction Status</h2>
        {events.length > 0 && (
          <span className="panel-note">{events.length} event(s) decoded from the receipt</span>
        )}
      </div>

      <div className={`tx-box tx-${status}`}>
        {steps.length > 1 && (
          <ol className="tx-steps">
            {steps.map((step) => (
              <li key={step.label} className={`tx-step ${step.state}`}>
                <span className="tx-step-dot" aria-hidden="true" />
                {step.label}
              </li>
            ))}
          </ol>
        )}

        <div className="tx-line">
          {status === "pending" && <span className="spinner dark" aria-hidden="true" />}
          <span className="tx-status">{LABELS[status]}</span>
        </div>

        {tx?.message && <p className="tx-message">{tx.message}</p>}

        {tx?.hash && (
          <div className="tx-hash-row">
            <span className="tx-hash-label">Tx hash</span>
            <code className="tx-hash">{tx.hash}</code>
            <a
              className="tx-link"
              href={`${EXPLORER_TX_BASE_URL}${tx.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Sepolia Etherscan ↗
            </a>
          </div>
        )}

        {events.length > 0 && (
          <div className="event-log">
            <span className="event-log-title">Events emitted</span>
            <ul className="event-list">
              {events.map((event, index) => (
                <li key={`${event.source}-${event.name}-${index}`} className="event-item">
                  <span className={`event-badge ${event.standard === "ERC-4626" ? "erc4626" : "erc20"}`}>
                    {event.standard}
                  </span>
                  <code className="event-sig">
                    {event.source}.{event.name}
                  </code>
                  <span className="event-args">
                    {event.args
                      .map((arg) => `${arg.name}: ${renderArg(arg, decimals)}`)
                      .join("  ·  ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
