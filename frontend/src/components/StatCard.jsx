/**
 * One headline number.
 *
 * `value` arrives already formatted — the caller owns decimal handling, since
 * only it knows whether the number is 18-decimal ETH or 6-decimal USDC.
 */
export default function StatCard({ label, value, unit, hint, loading, accent = false }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {loading ? (
          <span className="skeleton" />
        ) : (
          <>
            {value}
            {unit && <span className="stat-unit">{unit}</span>}
          </>
        )}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
