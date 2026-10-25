import { formatUnits } from "ethers";

/**
 * Display formatting for the platform. Amounts stay bigint everywhere else;
 * these only turn them into text, scaled to the size of the number so a
 * dust balance and a million-token reserve both read well.
 */

/** "1,234.56", "0.0042", "<0.0001", "1.25M". */
export function fmtToken(raw, decimals = 18, { compact = true } = {}) {
  if (raw === null || raw === undefined) return "—";
  if (raw === 0n) return "0";
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n)) return formatUnits(raw, decimals);
  if (n < 0.0001) return "<0.0001";
  if (compact && n >= 1_000_000)
    return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** A rate like "1 DXA = 0.4987 DXB" from two raw amounts. */
export function fmtRate(numerator, numDecimals, denominator, denDecimals) {
  if (!numerator || !denominator) return "—";
  const n = Number(formatUnits(numerator, numDecimals)) / Number(formatUnits(denominator, denDecimals));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

/** `part / whole` as "12.34%". */
export function fmtShare(part, whole) {
  if (part === null || part === undefined || !whole) return "—";
  const bps = Number((part * 1_000_000n) / whole) / 10_000;
  if (bps > 0 && bps < 0.01) return "<0.01%";
  return `${bps.toFixed(2)}%`;
}

/** An 18-decimal USD value as "$1,234.56", "<$0.01" or "$1.25M". */
export function fmtUsd(value, { compact = true } = {}) {
  if (value === null || value === undefined) return "—";
  if (value === 0n) return "$0.00";
  const n = Number(formatUnits(value, 18));
  if (n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    ...(compact && n >= 1_000_000 ? { notation: "compact", maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
}

/** A unit price: cents above $1, six significant digits below ("$0.197947"). */
export function fmtPrice(price) {
  if (price === null || price === undefined) return "—";
  const n = Number(formatUnits(price, 18));
  return n >= 1
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : `$${n.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
}

/** Basis points as "4.25%", "265%", "<0.01%" or "3.2M%". */
export function fmtBps(bps) {
  if (bps === null || bps === undefined) return "—";
  const pct = Number(bps) / 100;
  if (pct > 0 && pct < 0.01) return "<0.01%";
  if (pct >= 100_000) return `${pct.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}%`;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: pct >= 100 ? 0 : 2 })}%`;
}

/** Signed parts-per-million as "+1.25%" / "−0.40%". */
export function fmtPpm(ppm) {
  if (ppm === null || ppm === undefined) return "—";
  const pct = ppm / 10_000;
  const abs = Math.abs(pct);
  const text = abs >= 10_000 ? abs.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : abs.toFixed(2);
  return `${pct < 0 ? "−" : "+"}${text}%`;
}

/** "3 min ago" for the activity log. */
export function timeAgo(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
