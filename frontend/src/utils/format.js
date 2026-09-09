import { formatUnits, parseUnits } from "ethers";

/**
 * Decimal-safe formatting and parsing helpers.
 *
 * Experiment 3 introduced a token that does NOT use 18 decimals: MockUSDC uses
 * 6, exactly like real USDC. That makes `parseEther` / `formatEther` actively
 * wrong here — `parseEther("100")` would ask for 100 * 10^18 base units, which
 * is 10^12 times more USDC than the user typed.
 *
 * Every helper below therefore takes the token's decimals explicitly, and the
 * app reads those decimals from the contract at runtime rather than assuming
 * them, so the UI stays correct even if the underlying asset is swapped.
 */

/**
 * Format a raw base-unit amount for display.
 *
 * @param {bigint|null|undefined} raw       amount in the token's smallest unit
 * @param {number} decimals                 the token's decimals
 * @param {number} [displayDecimals=2]      digits to show after the point
 * @returns {string} e.g. "1,000.00"
 */
export function formatAmount(raw, decimals, displayDecimals = 2) {
  if (raw === null || raw === undefined) return "—";

  const exact = formatUnits(raw, decimals);
  const asNumber = Number(exact);

  // Very large values lose precision as a JS number; fall back to the exact
  // string rather than printing something subtly wrong.
  if (!Number.isFinite(asNumber)) return exact;

  return asNumber.toLocaleString("en-US", {
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  });
}

/**
 * Full-precision string for an amount — used for "Max" buttons and validation,
 * where a rounded display value could ask for more than the user actually has.
 *
 * @param {bigint|null|undefined} raw
 * @param {number} decimals
 * @returns {string}
 */
export function toExactString(raw, decimals) {
  if (raw === null || raw === undefined) return "0";
  return formatUnits(raw, decimals);
}

/**
 * Validate a user-typed amount without throwing.
 *
 * @param {string} input
 * @param {number} decimals
 * @returns {{ ok: true, value: bigint } | { ok: false, error: string }}
 */
export function parseAmount(input, decimals) {
  const trimmed = String(input ?? "").trim();

  if (trimmed === "") return { ok: false, error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".")
    return { ok: false, error: "Enter a valid number, e.g. 100.5" };

  const [, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals)
    return {
      ok: false,
      // parseUnits would throw here; catching it first gives a useful message.
      error: `This token has ${decimals} decimals, so at most ${decimals} digits after the point.`,
    };

  let value;
  try {
    value = parseUnits(trimmed, decimals);
  } catch {
    return { ok: false, error: "Enter a valid number, e.g. 100.5" };
  }

  if (value <= 0n) return { ok: false, error: "Amount must be greater than zero." };
  return { ok: true, value };
}

/** 0x71A0...92A4 — for navbar pills and log tables. */
export function shortAddress(address, lead = 6, tail = 4) {
  if (!address) return "—";
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

/**
 * Exchange rate between one share and the underlying asset, for display only.
 *
 * @param {bigint|null} oneShareInAssets  convertToAssets(1 share), raw
 * @param {number} assetDecimals
 * @returns {string} e.g. "1.0000"
 */
export function formatRate(oneShareInAssets, assetDecimals) {
  if (oneShareInAssets === null || oneShareInAssets === undefined) return "—";
  return Number(formatUnits(oneShareInAssets, assetDecimals)).toFixed(4);
}
