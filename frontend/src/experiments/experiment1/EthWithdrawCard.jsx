import { useState } from "react";

/**
 * Withdraw card.
 *
 * Validates the amount against the user's *vault* balance before ever asking
 * MetaMask to sign — that saves the user a guaranteed-to-revert transaction.
 * The contract enforces the same rule on-chain.
 */
export default function EthWithdrawCard({
  onWithdraw,
  myVaultBalance, // rounded, for display
  myVaultExact, // full-precision, for Max + validation
  disabled,
  pending,
}) {
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  // Max fills the *exact* balance — the displayed 4-decimal value can round up
  // and would then be rejected by the contract.
  const handleMax = () => {
    setLocalError("");
    setAmount(myVaultExact);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");

    const trimmed = amount.trim();
    if (trimmed === "") {
      setLocalError("Enter an amount to withdraw.");
      return;
    }

    const value = Number(trimmed);
    if (Number.isNaN(value)) {
      setLocalError("Enter a valid number, e.g. 0.05");
      return;
    }
    if (value <= 0) {
      setLocalError("Withdrawal must be greater than 0 ETH.");
      return;
    }
    if (value > Number(myVaultExact)) {
      setLocalError(`You only have ${myVaultBalance} ETH in the vault.`);
      return;
    }

    const ok = await onWithdraw(trimmed);
    if (ok) setAmount("");
  };

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Withdraw ETH</h2>
      </div>
      <p className="card-sub">
        Take your ETH back out. Available: <strong>{myVaultBalance} ETH</strong>
      </p>

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
            <button
              type="button"
              className="btn-max"
              onClick={handleMax}
              disabled={disabled || pending}
            >
              Max
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="btn btn-outline btn-block"
          disabled={disabled || pending}
        >
          {pending ? (
            <>
              <span className="spinner dark" aria-hidden="true" /> Withdrawing...
            </>
          ) : (
            "Withdraw"
          )}
        </button>
      </form>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
