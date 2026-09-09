import { useEffect, useState } from "react";

import { formatAmount, parseAmount } from "../../utils/format";

/**
 * The asset ↔ share exchange rate, both directions, live from the vault.
 *
 *   convertToShares(assets)  what N assets are worth in shares
 *   convertToAssets(shares)  what N shares are worth in assets
 *
 * Neither costs gas and neither changes anything — they are the vault's
 * *ideal* rate, ignoring rounding and fees, which is what makes them the right
 * functions for a rate display. (The preview* functions are the ones to trust
 * for an actual transaction, and those live on the deposit and withdraw
 * panels.)
 *
 * With no yield strategy attached the rate sits at 1:1. It only moves when the
 * vault gains assets without minting shares — which is precisely the mechanism
 * later VaultWise experiments will use.
 */

/** One direction of the calculator. */
function ConversionRow({ label, call, inputSymbol, outputSymbol, inputDecimals, outputDecimals, convert, defaultValue }) {
  const [value, setValue] = useState(defaultValue);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const parsed = parseAmount(value, inputDecimals);

    if (!parsed.ok) {
      setResult(null);
      setError(value.trim() === "" ? "" : parsed.error);
      return undefined;
    }
    setError("");

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const converted = await convert(parsed.value);
        if (!cancelled) setResult(converted);
      } catch (conversionError) {
        console.error("[VaultWise] conversion failed", conversionError);
        if (!cancelled) setResult(null);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, inputDecimals, convert]);

  return (
    <div className="convert-row">
      <div className="convert-head">
        <span className="convert-label">{label}</span>
        <code className="convert-call">{call}</code>
      </div>

      <div className="convert-body">
        <div className="input-wrap">
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={label}
          />
          <span className="input-suffix">{inputSymbol}</span>
        </div>

        <span className="convert-arrow" aria-hidden="true">
          →
        </span>

        <div className="convert-result">
          <span className="convert-result-value">
            {result === null ? "—" : formatAmount(result, outputDecimals, 6)}
          </span>
          <span className="convert-result-unit">{outputSymbol}</span>
        </div>
      </div>

      {error && <p className="inline-error">{error}</p>}
    </div>
  );
}

export default function ConversionPanel({ meta, convertToShares, convertToAssets }) {
  const { assetDecimals, shareDecimals, assetSymbol, shareSymbol } = meta;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Conversion</h2>
        <span className="panel-note">Free view calls — no gas, no signature</span>
      </div>

      <div className="convert-grid">
        <ConversionRow
          label={`${assetSymbol} → Vault Shares`}
          call="convertToShares()"
          inputSymbol={assetSymbol}
          outputSymbol={shareSymbol}
          inputDecimals={assetDecimals}
          outputDecimals={shareDecimals}
          convert={convertToShares}
          defaultValue="100"
        />
        <ConversionRow
          label={`Vault Shares → ${assetSymbol}`}
          call="convertToAssets()"
          inputSymbol={shareSymbol}
          outputSymbol={assetSymbol}
          inputDecimals={shareDecimals}
          outputDecimals={assetDecimals}
          convert={convertToAssets}
          defaultValue="100"
        />
      </div>
    </section>
  );
}
