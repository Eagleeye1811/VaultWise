import { EXPLORER_ADDRESS_BASE_URL, VAULT_4626_ADDRESS } from "../../contracts/contractConfig";

/**
 * The VaultWise-specific feature, rendered.
 *
 * `vaultProfile()` is the one application-specific addition Experiment 3 makes
 * on top of the ERC-4626 standard. It is pure read-only metadata — it writes no
 * storage and no ERC-4626 function consults it — so the vault's asset/share
 * accounting is exactly what the standard specifies with or without it.
 *
 * It earns its place because VaultWise is a multi-vault product with no backend
 * and no database. Without on-chain metadata this card could only show an
 * address; with it, the vault describes itself, and the description can never
 * drift out of sync with the contract it describes.
 */
export default function VaultProfileCard({ profile, loading }) {
  if (loading || !profile) {
    return (
      <section className="panel profile-card">
        <div className="panel-head">
          <h2>Vault Profile</h2>
          <span className="panel-note">vaultProfile() — VaultWise feature</span>
        </div>
        <div className="profile-skeleton">
          <span className="skeleton wide" />
          <span className="skeleton" />
        </div>
      </section>
    );
  }

  return (
    <section className="panel profile-card">
      <div className="panel-head">
        <h2>Vault Profile</h2>
        <span className="panel-note">vaultProfile() — VaultWise feature</span>
      </div>

      <div className="profile-top">
        <div>
          <h3 className="profile-label">{profile.label}</h3>
          <div className="profile-tags">
            <span className="tag">{profile.category}</span>
            <span className="tag tag-muted">{profile.experiment}</span>
          </div>
        </div>

        <div className="profile-flow" aria-label="Asset to share conversion">
          <span className="flow-token">{profile.assetSymbol}</span>
          <span className="flow-arrow" aria-hidden="true">
            →
          </span>
          <span className="flow-token flow-share">{profile.shareSymbol}</span>
        </div>
      </div>

      <p className="profile-risk">{profile.riskNote}</p>

      <dl className="kv kv-tight">
        <div>
          <dt>Vault (ERC-4626)</dt>
          <dd className="mono">
            <a
              href={`${EXPLORER_ADDRESS_BASE_URL}${VAULT_4626_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              {VAULT_4626_ADDRESS} ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>Underlying asset — asset()</dt>
          <dd className="mono">
            <a
              href={`${EXPLORER_ADDRESS_BASE_URL}${profile.assetAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              {profile.assetAddress} ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>Decimals</dt>
          <dd>
            {profile.assetSymbol} {profile.assetDecimals} · {profile.shareSymbol}{" "}
            {profile.shareDecimals}
          </dd>
        </div>
      </dl>
    </section>
  );
}
