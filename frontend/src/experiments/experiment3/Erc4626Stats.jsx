import StatCard from "../../components/StatCard";
import { formatAmount, formatRate } from "../../utils/format";

/**
 * The four numbers that describe an ERC-4626 position.
 *
 * Note the pairing: the vault side is (totalAssets, totalSupply), the user side
 * is (their shares, what those shares are currently worth). Together they show
 * the whole point of the standard — a share is a claim on a pool, not a
 * receipt for a fixed amount.
 */
export default function Erc4626Stats({ data, meta, loading }) {
  const { assetDecimals, shareDecimals, assetSymbol, shareSymbol } = meta;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Vault Statistics</h2>
        <span className="panel-note">
          1 {shareSymbol} ≈ {formatRate(data.rate, assetDecimals)} {assetSymbol}
        </span>
      </div>

      <div className="stats-grid stats-grid-4">
        <StatCard
          label="Total Vault Assets"
          value={formatAmount(data.totalAssets, assetDecimals)}
          unit={assetSymbol}
          hint="totalAssets() — everything the vault holds"
          loading={loading}
        />
        <StatCard
          label="Total Vault Shares"
          value={formatAmount(data.totalSupply, shareDecimals)}
          unit={shareSymbol}
          hint="totalSupply() — every share in circulation"
          loading={loading}
        />
        <StatCard
          label="Your Vault Shares"
          value={formatAmount(data.shareBalance, shareDecimals)}
          unit={shareSymbol}
          hint="balanceOf(you) — your ERC-20 share balance"
          loading={loading}
          accent
        />
        <StatCard
          label="Your Underlying Value"
          value={formatAmount(data.userAssetValue, assetDecimals)}
          unit={assetSymbol}
          hint="convertToAssets(your shares) — what they are worth now"
          loading={loading}
          accent
        />
      </div>
    </section>
  );
}
