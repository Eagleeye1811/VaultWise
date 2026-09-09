import { useEffect, useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";

/**
 * Taking assets back out — the two ways ERC-4626 offers, and they are not the
 * same operation:
 *
 *   withdraw(assets, receiver, owner)  you fix the ASSETS you want back; the
 *                                      vault burns however many shares that
 *                                      costs.
 *   redeem(shares, receiver, owner)    you fix the SHARES to burn; the vault
 *                                      sends whatever they are currently worth.
 *
 * With no yield attached the two look identical, which is exactly why both are
 * shown side by side: the difference only becomes visible once a share is worth
 * more than one asset, and by then the UI needs to already be correct.
 *
 * No approval is needed here — you are burning your own shares, so the vault
 * never has to pull anything from you.
 */

const MODES = {
  withdraw: {
    key: "withdraw",
    tab: "Withdraw assets",
    lede: "You choose how much USDC to take out. The vault burns the shares it costs.",
    call: "withdraw(assets, receiver, owner)",
    actionLabel: "Withdraw",
  },
  redeem: {
    key: "redeem",
    tab: "Redeem shares",
    lede: "You choose how many shares to burn. The vault sends what they are worth.",
    call: "redeem(shares, receiver, owner)",
    actionLabel: "Redeem",
  },
};

export default function WithdrawPanel({
  meta,
  shareBalance,
  maxWithdraw,
  maxRedeem,
  onWithdraw,
  onRedeem,
  previewWithdraw,
  previewRedeem,
  disabled,
  pendingAction,
}) {
  const [mode, setMode] = useState("withdraw");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState(null);

  const { assetDecimals, shareDecimals, assetSymbol, shareSymbol } = meta;
  const config = MODES[mode];

  const inputDecimals = mode === "withdraw" ? assetDecimals : shareDecimals;
  const inputSymbol = mode === "withdraw" ? assetSymbol : shareSymbol;
  const outputSymbol = mode === "withdraw" ? shareSymbol : assetSymbol;
  const outputDecimals = mode === "withdraw" ? shareDecimals : assetDecimals;

  // The on-chain ceiling for this mode, straight from the vault's limit functions.
  const limit = mode === "withdraw" ? maxWithdraw : maxRedeem;

  const parsed = useMemo(
    () => parseAmount(amount, inputDecimals),
    [amount, inputDecimals]
  );

  useEffect(() => {
    if (!parsed.ok) {
      setPreview(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const value =
          mode === "withdraw"
            ? await previewWithdraw(parsed.value)
            : await previewRedeem(parsed.value);
        if (!cancelled) setPreview(value);
      } catch (error) {
        console.error("[VaultWise] preview failed", error);
        if (!cancelled) setPreview(null);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parsed.ok, parsed.value, mode, previewWithdraw, previewRedeem]);

  const switchMode = (next) => {
    setMode(next);
    setAmount("");
    setPreview(null);
    setLocalError("");
  };

  // Max fills the *exact* limit — a rounded display value could round up and
  // the vault would then reject the transaction.
  const handleMax = () => {
    setLocalError("");
    setAmount(toExactString(limit, inputDecimals));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    if (limit !== null && parsed.value > limit) {
      setLocalError(
        mode === "withdraw"
          ? `You can withdraw at most ${formatAmount(limit, assetDecimals)} ${assetSymbol} (maxWithdraw).`
          : `You only hold ${formatAmount(limit, shareDecimals)} ${shareSymbol} (maxRedeem).`
      );
      return;
    }
    setLocalError("");

    const ok =
      mode === "withdraw" ? await onWithdraw(parsed.value) : await onRedeem(parsed.value);
    if (ok) {
      setAmount("");
      setPreview(null);
    }
  };

  const busy = pendingAction === mode;

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Withdraw</h2>
        <span className="panel-note mono">{config.call}</span>
      </div>

      <div className="tabs" role="tablist">
        {Object.values(MODES).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={mode === entry.key}
            className={`tab ${mode === entry.key ? "active" : ""}`}
            onClick={() => switchMode(entry.key)}
            disabled={busy}
          >
            {entry.tab}
          </button>
        ))}
      </div>

      <p className="card-sub">{config.lede}</p>

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="field-label">
            Amount
            <span className="field-hint">
              {mode === "withdraw"
                ? `maxWithdraw ${formatAmount(maxWithdraw, assetDecimals)} ${assetSymbol}`
                : `maxRedeem ${formatAmount(maxRedeem, shareDecimals)} ${shareSymbol}`}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="50"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={disabled || busy}
            />
            <span className="input-suffix">{inputSymbol}</span>
            <button
              type="button"
              className="btn-max"
              onClick={handleMax}
              disabled={disabled || busy}
            >
              Max
            </button>
          </div>
        </label>

        <div className="preview-line">
          {parsed.ok && preview !== null ? (
            <>
              <span className="preview-label">
                {mode === "withdraw" ? "Shares that will burn" : "You will receive"}
              </span>
              <span className="preview-value">
                {formatAmount(preview, outputDecimals)} {outputSymbol}
              </span>
              <span className="preview-src">
                {mode === "withdraw" ? "previewWithdraw()" : "previewRedeem()"}
              </span>
            </>
          ) : (
            <span className="preview-idle">
              Enter an amount to see what the vault quotes.
            </span>
          )}
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={disabled || busy || !parsed.ok}
        >
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> {config.actionLabel}ing...
            </>
          ) : (
            config.actionLabel
          )}
        </button>

        <p className="allowance-note">
          You hold {formatAmount(shareBalance, shareDecimals)} {shareSymbol}. Burning shares
          needs no approval — they are yours.
        </p>
      </form>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
