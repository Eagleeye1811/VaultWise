/**
 * A dismissible (or static) message strip.
 *
 * `tone` is one of: "warn" | "error" | "info".
 */
export default function Banner({ tone = "info", onDismiss, children }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="banner-body">{children}</span>
      {onDismiss && (
        <button className="banner-close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
