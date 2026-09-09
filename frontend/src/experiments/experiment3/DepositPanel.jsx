import { useEffect, useMemo, useState } from "react";

import { formatAmount, parseAmount, toExactString } from "../../utils/format";

/**
 * Putting assets into the vault — the two ways ERC-4626 offers.
 *
 *   deposit(assets, receiver)  you fix the ASSETS going in; the vault works out
 *                              how many shares that buys.
 *   mint(shares, receiver)     you fix the SHARES you want out; the vault works
 *                              out how many assets that costs.
 *
 * Both need an ERC-20 allowance first, because the vault pulls the tokens with
 * `transferFrom`. That is why this panel has two buttons rather than one: the
 * approval is a separate transaction on a separate contract, and the brief asks
 * for both to be visible.
 */

const MODES = {
  deposit: {
    key: "deposit",
    tab: "Deposit assets",
    lede: "You choose how much to put in. The vault decides how many shares that buys.",
    call: "deposit(assets, receiver)",
    actionLabel: "Deposit",
  },
  mint: {
    key: "mint",
    tab: "Mint shares",
    lede: "You choose how many shares you want. The vault decides what they cost.",
    call: "mint(shares, receiver)",
    actionLabel: "Mint Shares",
  },
};

export default function DepositPanel({
  meta,
  usdcBalance,
  allowance,
  onApprove,
  onDeposit,
  onMintShares,
  previewDeposit,
  previewMint,
  disabled,
  pendingAction,
}) {
  const [mode, setMode] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState(null); // bigint | null

  const { assetDecimals, shareDecimals, assetSymbol, shareSymbol } = meta;
  const config = MODES[mode];

  // The input is denominated in assets when depositing, shares when minting.
  const inputDecimals = mode === "deposit" ? assetDecimals : shareDecimals;
  const inputSymbol = mode === "deposit" ? assetSymbol : shareSymbol;
  const outputSymbol = mode === "deposit" ? shareSymbol : assetSymbol;
  const outputDecimals = mode === "deposit" ? shareDecimals : assetDecimals;

  const parsed = useMemo(
    () => parseAmount(amount, inputDecimals),
    [amount, inputDecimals]
  );

  /**
   * How much of the underlying this action will actually pull.
   * Depositing pulls exactly what you typed; minting pulls whatever
   * `previewMint` says the shares cost.
   */
  const assetsRequired = mode === "deposit" ? (parsed.ok ? parsed.value : null) : preview;

  const needsApproval =
    assetsRequired !== null &&
    assetsRequired !== undefined &&
    allowance !== null &&
    allowance < assetsRequired;

  /* ---------------------------------------------------------------- *
   * Live preview — previewDeposit() / previewMint() straight from chain
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!parsed.ok) {
      setPreview(null);
      return undefined;
    }

    let cancelled = false;
    // Debounced so typing does not fire an RPC call per keystroke.
    const timer = setTimeout(async () => {
      try {
        const value =
          mode === "deposit"
            ? await previewDeposit(parsed.value)
            : await previewMint(parsed.value);
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
  }, [parsed.ok, parsed.value, mode, previewDeposit, previewMint]);

  const switchMode = (next) => {
    setMode(next);
    setAmount("");
    setPreview(null);
    setLocalError("");
  };

  const validate = () => {
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return false;
    }
    if (assetsRequired === null || assetsRequired === undefined) {
      setLocalError("Still reading the price from the vault — try again in a moment.");
      return false;
    }
    if (usdcBalance !== null && assetsRequired > usdcBalance) {
      setLocalError(
        `That needs ${formatAmount(assetsRequired, assetDecimals)} ${assetSymbol}, but you hold ${formatAmount(usdcBalance, assetDecimals)}.`
      );
      return false;
    }
    setLocalError("");
    return true;
  };

  const handleApprove = async () => {
    if (!validate()) return;
    await onApprove(assetsRequired);
  };

  const handleAction = async () => {
    if (!validate()) return;
    const ok =
      mode === "deposit" ? await onDeposit(parsed.value) : await onMintShares(parsed.value);
    if (ok) {
      setAmount("");
      setPreview(null);
    }
  };

  const handleMax = () => {
    setLocalError("");
    if (mode === "deposit") {
      setAmount(toExactString(usdcBalance, assetDecimals));
    } else {
      // Minting is capped by what your balance can pay for, which at the
      // current rate is convertToShares(balance) — previewDeposit is exactly
      // that, so reuse it rather than guessing.
      previewDeposit(usdcBalance ?? 0n)
        .then((shares) => setAmount(toExactString(shares, shareDecimals)))
        .catch(() => setAmount(""));
    }
  };

  const busy = pendingAction === "approve" || pendingAction === mode;

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Deposit</h2>
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

      <div className="form">
        <label className="field">
          <span className="field-label">
            Amount
            <span className="field-hint">
              you hold {formatAmount(usdcBalance, assetDecimals)} {assetSymbol}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder={mode === "deposit" ? "100" : "100"}
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
                {mode === "deposit" ? "You will receive" : "This will cost"}
              </span>
              <span className="preview-value">
                {formatAmount(preview, outputDecimals)} {outputSymbol}
              </span>
              <span className="preview-src">
                {mode === "deposit" ? "previewDeposit()" : "previewMint()"}
              </span>
            </>
          ) : (
            <span className="preview-idle">
              Enter an amount to see the exact {mode === "deposit" ? "shares" : "cost"} the
              vault quotes.
            </span>
          )}
        </div>

        <div className="step-actions">
          <div className="step">
            <span className={`step-num ${needsApproval ? "active" : "done"}`}>1</span>
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={handleApprove}
              disabled={disabled || busy || !parsed.ok || !needsApproval}
            >
              {pendingAction === "approve" ? (
                <>
                  <span className="spinner dark" aria-hidden="true" /> Approving...
                </>
              ) : needsApproval ? (
                "Approve Vault"
              ) : (
                "Approved ✓"
              )}
            </button>
          </div>

          <div className="step">
            <span className={`step-num ${needsApproval ? "" : "active"}`}>2</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleAction}
              disabled={disabled || busy || !parsed.ok || needsApproval}
            >
              {pendingAction === mode ? (
                <>
                  <span className="spinner" aria-hidden="true" /> {config.actionLabel}ing...
                </>
              ) : (
                config.actionLabel
              )}
            </button>
          </div>
        </div>

        <p className="allowance-note">
          Approved: {formatAmount(allowance, assetDecimals)} {assetSymbol}
          {needsApproval && " — not enough for this amount yet."}
        </p>
      </div>

      {localError && <p className="inline-error">{localError}</p>}
    </section>
  );
}
