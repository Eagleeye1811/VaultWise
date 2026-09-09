import StatCard from "../../components/StatCard";

/**
 * Experiment 1's three headline numbers.
 *
 * Values arrive already formatted as ETH strings — Experiment 1's vault is
 * denominated in native ETH, so 18 decimals throughout.
 */
export default function EthVaultStats({
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
        {connected && <span className="panel-note">Read directly from the blockchain</span>}
      </div>

      <div className="stats-grid">
        <StatCard
          label="Wallet Balance"
          value={walletBalance}
          unit="ETH"
          hint="ETH held in your MetaMask account"
          loading={loading}
        />
        <StatCard
          label="My Vault Balance"
          value={myVaultBalance}
          unit="ETH"
          hint="ETH you have deposited into VaultWise"
          loading={loading}
          accent
        />
        <StatCard
          label="Total Vault"
          value={totalVaultBalance}
          unit="ETH"
          hint="ETH held by the VaultWise contract"
          loading={loading}
        />
      </div>
    </section>
  );
}
