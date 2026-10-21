import { usePlatform } from "./usePlatform";
import { fmtToken } from "./format";
import { toExactString } from "../utils/format";

/**
 * The platform's building blocks. Small, presentational, and shared by every
 * page so Swap, Pools and Earn look and behave like one product.
 */

/* ── icons (inline SVG, stroke = currentColor) ─────────────────────────── */

const ICON_PATHS = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  drop: "M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01",
  faucet: "M4 9h9a3 3 0 0 1 3 3v1M8 9V5h4M16 17s-1.5 2-1.5 3a1.5 1.5 0 0 0 3 0c0-1-1.5-3-1.5-3z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  flask: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M8 8h11v11H8zM5 16V5h11",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6 6 18",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevron: "M9 6l6 6-6 6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      className={`vw-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name] ?? ICON_PATHS.info} />
    </svg>
  );
}

/* ── tokens ────────────────────────────────────────────────────────────── */

/** A coloured disc with the symbol's initials — no third-party logos. */
export function TokenIcon({ token, size = 28 }) {
  const symbol = token?.symbol ?? "?";
  const label = symbol === "ETH" ? "Ξ" : symbol.replace(/^vw/, "").slice(0, 3);
  return (
    <span
      className="vw-token-icon"
      style={{ width: size, height: size, fontSize: size * 0.34, background: token?.hue ?? "#5d636b" }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

export function TokenPair({ a, b, size = 28 }) {
  return (
    <span className="vw-token-pair">
      <TokenIcon token={a} size={size} />
      <TokenIcon token={b} size={size} />
    </span>
  );
}

/** "1,234.56 DXA" with the number in tabular figures. */
export function Amount({ raw, token, decimals, suffix = true }) {
  const d = decimals ?? token?.decimals ?? 18;
  return (
    <span className="vw-amount" title={raw !== null && raw !== undefined ? `${toExactString(raw, d)} ${token?.symbol ?? ""}` : undefined}>
      {fmtToken(raw, d)}
      {suffix && token && <span className="vw-amount-sym"> {token.symbol}</span>}
    </span>
  );
}

/* ── layout primitives ─────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="vw-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="vw-page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = "", padded = true }) {
  return (
    <section className={`vw-card ${padded ? "" : "vw-card-flush"} ${className}`}>
      {(title || actions) && (
        <div className="vw-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="vw-card-sub">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, loading }) {
  return (
    <div className="vw-stat">
      <span className="vw-stat-label">{label}</span>
      <span className="vw-stat-value">{loading ? <Skeleton width="60%" /> : value}</span>
      {sub && <span className="vw-stat-sub">{sub}</span>}
    </div>
  );
}

export function Skeleton({ width = "100%", height = "1em" }) {
  return <span className="vw-skeleton" style={{ width, height }} />;
}

export function Badge({ tone = "neutral", title, children }) {
  return (
    <span className={`vw-badge vw-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Notice({ tone = "info", children }) {
  return (
    <div className={`vw-notice vw-notice-${tone}`} role={tone === "error" ? "alert" : "note"}>
      <Icon name={tone === "error" || tone === "warn" ? "info" : "shield"} size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Row({ label, children, strong = false }) {
  return (
    <div className={`vw-row ${strong ? "vw-row-strong" : ""}`}>
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function Tabs({ value, onChange, options, size = "md" }) {
  return (
    <div className={`vw-tabs vw-tabs-${size}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon = "info", title, children, action }) {
  return (
    <div className="vw-empty">
      <span className="vw-empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ── inputs ────────────────────────────────────────────────────────────── */

/**
 * The amount box used by every form: big number input, token chip, wallet
 * balance and a Max button that fills the exact (unrounded) balance.
 */
export function AmountField({ label, value, onChange, token, balance, balanceLabel = "Balance", tokenSlot, readOnly = false, error }) {
  const decimals = token?.decimals ?? 18;
  return (
    <div className={`vw-field ${error ? "vw-field-error" : ""}`}>
      <div className="vw-field-top">
        <span>{label}</span>
        {balance !== undefined && (
          <span className="vw-field-balance">
            {balanceLabel}: <Amount raw={balance} token={token} suffix={false} />
            {!readOnly && balance !== null && balance > 0n && (
              <button type="button" className="vw-max" onClick={() => onChange(toExactString(balance, decimals))}>
                Max
              </button>
            )}
          </span>
        )}
      </div>
      <div className="vw-field-main">
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value.replace(",", "."))}
          aria-label={`${label} amount`}
        />
        {tokenSlot ?? (
          token && (
            <span className="vw-token-chip">
              <TokenIcon token={token} size={22} />
              {token.symbol}
            </span>
          )
        )}
      </div>
      {error && <span className="vw-field-msg">{error}</span>}
    </div>
  );
}

/** A dropdown token chip. `options` are registry tokens. */
export function TokenSelect({ value, options, onChange, label }) {
  const selected = options.find((t) => t.id === value);
  return (
    <label className="vw-token-select">
      <TokenIcon token={selected} size={22} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((token) => (
          <option key={token.id} value={token.id}>
            {token.symbol}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={14} className="vw-rot90" />
    </label>
  );
}

/* ── the one action button ─────────────────────────────────────────────── */

/**
 * Every write on the platform goes through this button, so the gating is the
 * same everywhere: wallet installed → connected → on Sepolia → product
 * deployed → input valid → not already sending.
 */
export function ActionButton({ label, onClick, disabledReason, flowKey, configured = true, variant = "primary", block = true }) {
  const { wallet, busy } = usePlatform();
  const cls = `vw-btn vw-btn-${variant} ${block ? "vw-btn-block" : ""}`;

  if (!wallet.hasWallet)
    return (
      <a className={cls} href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install MetaMask
      </a>
    );
  if (!wallet.account)
    return (
      <button type="button" className={cls} onClick={wallet.connect} disabled={wallet.isConnecting}>
        {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  if (!wallet.isCorrectNetwork)
    return (
      <button type="button" className={`${cls} vw-btn-warn`} onClick={wallet.switchToTargetNetwork}>
        Switch to Sepolia
      </button>
    );
  if (!configured)
    return (
      <button type="button" className={cls} disabled>
        Not deployed yet
      </button>
    );
  if (busy && busy === flowKey)
    return (
      <button type="button" className={cls} disabled>
        <span className="vw-spinner" aria-hidden="true" /> Confirming…
      </button>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={Boolean(disabledReason) || Boolean(busy)}>
      {disabledReason || label}
    </button>
  );
}

/* ── a two-part composition bar (pool reserves) ────────────────────────── */

/**
 * Share of each side of a pool by token count. The two series use slots 1 and
 * 2 of the validated categorical palette and are always labelled in text, so
 * the split never relies on colour alone.
 */
export function CompositionBar({ left, right, leftLabel, rightLabel }) {
  const total = (left ?? 0n) + (right ?? 0n);
  const leftPct = total === 0n ? 50 : Number((left * 10_000n) / total) / 100;
  return (
    <div className="vw-comp">
      <div className="vw-comp-bar" role="img" aria-label={`${leftLabel} ${leftPct.toFixed(1)}%, ${rightLabel} ${(100 - leftPct).toFixed(1)}%`}>
        <span className="vw-comp-a" style={{ width: `${leftPct}%` }} />
        <span className="vw-comp-b" style={{ width: `${100 - leftPct}%` }} />
      </div>
      <div className="vw-comp-legend">
        <span>
          <i className="vw-dot vw-dot-a" /> {leftLabel} {total === 0n ? "—" : `${leftPct.toFixed(1)}%`}
        </span>
        <span>
          <i className="vw-dot vw-dot-b" /> {rightLabel} {total === 0n ? "—" : `${(100 - leftPct).toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
}
