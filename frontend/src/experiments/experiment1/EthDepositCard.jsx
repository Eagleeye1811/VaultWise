import { useState } from "react";

/**
 * Deposit card.
 *
 * Input-level validation happens here (empty / not a number / <= 0 /
 * more ETH than the wallet holds). The actual signed transaction is done by
 * App.jsx via `onDeposit(amount)`.
 */
export default function EthDepositCard({ onDeposit, walletBalance, disabled, pending }) {
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");

    const trimmed = amount.trim();
    if (trimmed === "") {
      setLocalError("Enter an amount to deposit.");
      return;
    }

    const value = Number(trimmed);
    if (Number.isNaN(value)) {
      setLocalError("Enter a valid number, e.g. 0.05");
      return;
    }
    if (value <= 0) {
      setLocalError("Deposit must be greater than 0 ETH.");
      return;
    }
    if (Number(walletBalance) === 0 || value > Number(walletBalance)) {
      setLocalError("You do not have that much ETH in your wallet.");
      return;
    }

    const ok = await onDeposit(trimmed);
    if (ok) setAmount("");
  };

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Deposit ETH</h2>
      </div>
      <p className="card-sub">Move ETH from your wallet into the VaultWise vault.</p>

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="field-label">Amount</span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled || pending}
            />
            <span className="input-suffix">ETH</span>
          </div>
        </label>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={disabled || pending}
        >
          {pending ? (
            <>
              <span className="spinner" aria-hidden="true" /> Depositing...
            </>
          ) : (
            "Deposit"
          )}
        </button>
      </form>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
