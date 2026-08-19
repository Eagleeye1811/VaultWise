import { EXPLORER_TX_BASE_URL } from "../contracts/contractConfig";

/**
 * Shows the state of the most recent transaction.
 *
 * `tx` shape (owned by App.jsx):
 *   { status: "idle" | "pending" | "confirmed" | "failed",
 *     hash: string | null,
 *     message: string }
 *
 * The hash is never faked — it only appears once ethers returns a real one.
 */
const LABELS = {
  idle: "No recent transaction",
  pending: "Transaction pending...",
  confirmed: "Transaction confirmed ✓",
  failed: "Transaction failed",
};

export default function TransactionStatus({ tx }) {
  const status = tx?.status ?? "idle";

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Transaction Status</h2>
      </div>

      <div className={`tx-box tx-${status}`}>
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
      </div>
    </section>
  );
}
