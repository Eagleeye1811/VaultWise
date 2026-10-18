import { useEffect, useMemo, useState } from "react";

import { EXPLORER_ADDRESS_BASE_URL } from "../../contracts/contractConfig";
import { friendlyError } from "../../utils/errors";
import { formatAmount, parseAmount, shortAddress, toExactString } from "../../utils/format";
import { formatPpm, formatRatio, minOutForTolerance, priceImpactPpm } from "./ammMath";

/**
 * Swap either way against the pool.
 *
 *   TKA → TKB   approve(pool, amountIn) on TKA, then swapAForB(amountIn)
 *   TKB → TKA   approve(pool, amountIn) on TKB, then swapBForA(amountIn)
 *
 * Every number here is labelled as one of:
 *   live        reserves, balance, allowance — read from chain
 *   calculated  the quote (the contract's own getAmountOut), price impact and
 *               the minimum received at your tolerance
 *
 * Fees: SimpleAMM charges none. Rounding: the contract rounds the new output
 * reserve UP, so the output is at most 1 base unit below the exact
 * real-number result — always in the pool's favour.
 *
 * Slippage: SimpleAMM's swap functions take no minimum-output argument (their
 * signatures are fixed by the experiment sheet). The tolerance below is
 * enforced by simulating the swap immediately before MetaMask opens; it
 * cannot protect against reserves moving after you sign.
 */

const DIRECTIONS = {
  AtoB: { inSide: "A", outSide: "B", call: "swapAForB(amountAIn)" },
  BtoA: { inSide: "B", outSide: "A", call: "swapBForA(amountBIn)" },
};

const TOLERANCES_BPS = [10, 50, 100, 300];

export default function SwapPanel({
  meta,
  data,
  quote,
  onApprove,
  onSwap,
  onCheck,
  preflight,
  checking,
  disabled,
  busy,
  pendingAction,
}) {
  const [direction, setDirection] = useState("AtoB");
  const [amount, setAmount] = useState("");
  const [toleranceBps, setToleranceBps] = useState(50);
  const [preview, setPreview] = useState(null); // bigint | null
  const [quoteError, setQuoteError] = useState("");
  const [localError, setLocalError] = useState("");

  const { inSide, outSide, call } = DIRECTIONS[direction];
  const tokenIn = meta[inSide];
  const tokenOut = meta[outSide];

  const balanceIn = inSide === "A" ? data.balanceA : data.balanceB;
  const allowanceIn = inSide === "A" ? data.allowanceA : data.allowanceB;
  const reserveIn = inSide === "A" ? data.reserveA : data.reserveB;
  const reserveOut = inSide === "A" ? data.reserveB : data.reserveA;

  const parsed = useMemo(() => parseAmount(amount, tokenIn.decimals), [amount, tokenIn.decimals]);
  const needsApproval = parsed.ok && allowanceIn !== null && allowanceIn < parsed.value;
  const exceedsBalance = parsed.ok && balanceIn !== null && parsed.value > balanceIn;

  /* ---------------------------------------------------------------- *
   * Live quote — getAmountOut() straight from the contract
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!parsed.ok || disabled) {
      setPreview(null);
      setQuoteError("");
      return undefined;
    }

    let cancelled = false;
    // Debounced so typing does not fire an RPC call per keystroke. Re-runs
    // when the reserves change (after a confirmed tx or a background refresh).
    const timer = setTimeout(async () => {
      try {
        const value = await quote(direction, parsed.value);
        if (!cancelled) {
          setPreview(value);
          setQuoteError("");
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setQuoteError(friendlyError(error, "The pool could not quote this amount."));
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parsed.ok, parsed.value, direction, quote, disabled, reserveIn, reserveOut]);

  const impact =
    parsed.ok && preview !== null && reserveIn !== null
      ? priceImpactPpm(parsed.value, preview, reserveIn, reserveOut)
      : null;
  const minOut = minOutForTolerance(preview, toleranceBps);

  const switchDirection = (next) => {
    setDirection(next);
    setAmount("");
    setPreview(null);
    setQuoteError("");
    setLocalError("");
  };

  const validate = () => {
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return false;
    }
    setLocalError("");
    return true;
  };

  const handleApprove = async () => {
    if (!validate()) return;
    await onApprove(inSide, parsed.value, {
      steps: [`Approve ${tokenIn.symbol}`, "Swap"],
      activeStep: 0,
    });
  };

  const handleCheck = async () => {
    if (!validate()) return;
    await onCheck(direction, parsed.value);
  };

  const handleSwap = async () => {
    if (!validate()) return;
    if (await onSwap(direction, parsed.value, preview, toleranceBps)) {
      setAmount("");
      setPreview(null);
    }
  };

  const report = preflight && preflight.direction === direction ? preflight : null;

  return (
    <section className="panel card">
      <div className="panel-head">
        <h2>Swap</h2>
        <span className="panel-note mono">
          <span className="kind kind-tx">tx</span> {call}
        </span>
      </div>

      <div className="tabs" role="tablist">
        {Object.entries(DIRECTIONS).map(([key, entry]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={direction === key}
            className={`tab ${direction === key ? "active" : ""}`}
            onClick={() => switchDirection(key)}
            disabled={busy}
          >
            {meta[entry.inSide].symbol} → {meta[entry.outSide].symbol}
          </button>
        ))}
      </div>

      <p className="card-sub">
        <span className="kind kind-read">live</span> Reserves{" "}
        {formatAmount(reserveIn, tokenIn.decimals, 4)} {tokenIn.symbol} /{" "}
        {formatAmount(reserveOut, tokenOut.decimals, 4)} {tokenOut.symbol} · spot 1 {tokenIn.symbol} ={" "}
        {formatRatio(reserveOut, tokenOut.decimals, reserveIn, tokenIn.decimals, 6)} {tokenOut.symbol}
      </p>

      <div className="form">
        <label className="field">
          <span className="field-label">
            You pay
            <span className="field-hint">
              you hold {formatAmount(balanceIn, tokenIn.decimals, 4)} · approved{" "}
              {formatAmount(allowanceIn, tokenIn.decimals, 4)}
            </span>
          </span>
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="1"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setLocalError("");
              }}
              disabled={disabled || busy}
            />
            <span className="input-suffix">{tokenIn.symbol}</span>
            <button
              type="button"
              className="btn-max"
              onClick={() => setAmount(toExactString(balanceIn, tokenIn.decimals))}
              disabled={disabled || busy || !balanceIn}
            >
              Max
            </button>
          </div>
        </label>

        {exceedsBalance && (
          <p className="inline-warn">
            Your wallet holds {formatAmount(balanceIn, tokenIn.decimals, 4)} {tokenIn.symbol}.
            {data.lpBalance > 0n &&
              ` Tokens you deposited as liquidity are in the pool, not your wallet — remove liquidity or mint more ${tokenIn.symbol} first.`}{" "}
            An approval does not add tokens.
          </p>
        )}

        <div className="preview-line">
          {parsed.ok && preview !== null ? (
            <>
              <span className="preview-label">
                <span className="kind kind-calc">calc</span> Educational no-fee quote
              </span>
              <span className="preview-value">
                {formatAmount(preview, tokenOut.decimals, 6)} {tokenOut.symbol}
              </span>
              <span className="preview-src">getAmountOut() · exact: {preview.toString()} base units</span>
            </>
          ) : quoteError ? (
            <span className="preview-idle">{quoteError}</span>
          ) : (
            <span className="preview-idle">
              Enter an amount to get the pool's quote for {tokenOut.symbol}.
            </span>
          )}
        </div>

        {parsed.ok && preview !== null && (
          <dl className="quote-grid">
            <div>
              <dt>Price impact</dt>
              <dd>{formatPpm(impact)}</dd>
            </div>
            <div>
              <dt>Effective rate</dt>
              <dd>
                {formatRatio(preview, tokenOut.decimals, parsed.value, tokenIn.decimals, 6)}{" "}
                {tokenOut.symbol}/{tokenIn.symbol}
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatAmount(minOut, tokenOut.decimals, 6)} {tokenOut.symbol}
              </dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>None (no-fee pool)</dd>
            </div>
          </dl>
        )}

        <div className="tolerance-row" role="group" aria-label="Slippage tolerance">
          <span className="field-label">Slippage tolerance</span>
          {TOLERANCES_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              className={`chip ${toleranceBps === bps ? "active" : ""}`}
              onClick={() => setToleranceBps(bps)}
              disabled={busy}
            >
              {bps / 100}%
            </button>
          ))}
        </div>

        <p className="allowance-note">
          Price impact is the curve's own slippage for this size (there is no fee). The output is
          rounded down by at most 1 base unit, in the pool's favour. Your tolerance is checked
          against a fresh simulation just before MetaMask opens; the contract itself has no
          minimum-output parameter, so the price can still move after you sign. The confirmed amount
          is taken from the Swap event.
        </p>

        <div className="step-actions">
          <div className="step">
            <span className={`step-num ${needsApproval ? "active" : "done"}`}>1</span>
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={handleApprove}
              disabled={disabled || busy || !parsed.ok || !needsApproval}
            >
              {pendingAction === `approve-${inSide}` ? (
                <>
                  <span className="spinner dark" aria-hidden="true" /> Approving...
                </>
              ) : needsApproval || !parsed.ok ? (
                `Approve ${tokenIn.symbol}`
              ) : (
                `${tokenIn.symbol} approved ✓`
              )}
            </button>
          </div>

          <div className="step">
            <span className={`step-num ${parsed.ok && !needsApproval ? "active" : ""}`}>2</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleSwap}
              disabled={disabled || busy || checking || !parsed.ok || needsApproval || preview === null}
            >
              {pendingAction === "swap" ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Swapping...
                </>
              ) : checking ? (
                "Checking..."
              ) : (
                "Swap"
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-block btn-small"
          onClick={handleCheck}
          disabled={disabled || busy || checking || !parsed.ok}
        >
          <span className="kind kind-read">read</span> Check this swap without sending
        </button>
      </div>

      {localError && <p className="inline-error">{localError}</p>}

      {report && <PreflightReport report={report} meta={meta} />}
    </section>
  );
}

/** The facts the pre-swap check read, and what it concluded. */
function PreflightReport({ report, meta }) {
  const tokenIn = meta[report.inSide];
  const tokenOut = meta[report.outSide];
  const ok = report.problems.length === 0;
  const fmtIn = (raw) => (raw === undefined || raw === null ? "—" : `${formatAmount(raw, tokenIn.decimals, 6)} ${tokenIn.symbol}`);
  const link = (address) =>
    address ? (
      <a href={`${EXPLORER_ADDRESS_BASE_URL}${address}`} target="_blank" rel="noreferrer">
        {shortAddress(address, 8, 6)}
      </a>
    ) : (
      "—"
    );

  return (
    <div className={`preflight ${ok ? "ok" : "bad"}`}>
      <div className="preflight-head">
        <strong>{ok ? "Pre-swap check passed" : "Pre-swap check found a problem — nothing was sent"}</strong>
        <span className="preflight-time">
          {report.block ? `block ${report.block} · ` : ""}
          {report.checkedAt.toLocaleTimeString()}
        </span>
      </div>

      {!ok && (
        <ul className="preflight-problems">
          {report.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {report.signerAddress && (
        <dl className="preflight-facts">
          <dt>Chain</dt>
          <dd>{report.chainId?.toString()}</dd>
          <dt>Signer (MetaMask)</dt>
          <dd className="mono">{link(report.signerAddress)}</dd>
          <dt>Connected (page)</dt>
          <dd className="mono">{link(report.account)}</dd>
          <dt>{tokenIn.symbol} (pool / config)</dt>
          <dd className="mono">
            {link(report.poolTokenIn)} / {link(report.configuredTokenIn)}
          </dd>
          <dt>Amount in</dt>
          <dd>
            {fmtIn(report.amountIn)} <span className="dd-note">{report.amountIn?.toString()} base units</span>
          </dd>
          <dt>Signer balance</dt>
          <dd>{fmtIn(report.balance)}</dd>
          <dt>Allowance to pool</dt>
          <dd>{fmtIn(report.allowance)}</dd>
          <dt>Reserves (A / B)</dt>
          <dd>
            {formatAmount(report.reserveA, meta.A.decimals, 6)} {meta.A.symbol} /{" "}
            {formatAmount(report.reserveB, meta.B.decimals, 6)} {meta.B.symbol}
          </dd>
          <dt>Signer LP shares</dt>
          <dd>
            {formatAmount(report.lpBalance, meta.lp.decimals, 6)} {meta.lp.symbol}
          </dd>
          <dt>Simulated output</dt>
          <dd>
            {report.simulated !== null && report.simulated !== undefined
              ? `${formatAmount(report.simulated, tokenOut.decimals, 6)} ${tokenOut.symbol}`
              : "not simulated"}
          </dd>
        </dl>
      )}
    </div>
  );
}
