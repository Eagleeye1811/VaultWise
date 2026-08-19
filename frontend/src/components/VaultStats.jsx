/**
 * The three headline numbers of the dashboard.
 * Values arrive already formatted as ETH strings (formatEther in App.jsx).
 */
function StatCard({ label, value, hint, loading }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {loading ? <span className="skeleton" /> : `${value} ETH`}
      </span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

export default function VaultStats({
  walletBalance,
  myVaultBalance,
  totalVaultBalance,
  loading,
  connected,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Vault Statistics</h2>
        {connected && (
          <span className="panel-note">Read directly from the blockchain</span>
        )}
      </div>

      <div className="stats-grid">
        <StatCard
          label="Wallet Balance"
          value={walletBalance}
          hint="ETH held in your MetaMask account"
          loading={loading}
        />
        <StatCard
          label="My Vault Balance"
          value={myVaultBalance}
          hint="ETH you have deposited into VaultWise"
          loading={loading}
        />
        <StatCard
          label="Total Vault"
          value={totalVaultBalance}
          hint="ETH held by the VaultWise contract"
          loading={loading}
        />
      </div>
    </section>
  );
}
