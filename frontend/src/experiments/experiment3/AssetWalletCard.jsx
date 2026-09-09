import { useState } from "react";

import { EXPLORER_ADDRESS_BASE_URL, USDC_ADDRESS } from "../../contracts/contractConfig";
import { formatAmount } from "../../utils/format";

/**
 * The wallet section: who you are, how much of the underlying ERC-20 you hold,
 * and how much of it the vault is currently allowed to move.
 *
 * The allowance row matters more than it looks. An ERC-4626 vault does not
 * receive tokens — it *pulls* them with `transferFrom`, and an ERC-20 refuses
 * that without an allowance. Showing the live allowance makes the two-step
 * approve-then-deposit flow legible instead of mysterious.
 *
 * The mint control is laboratory scaffolding for `MockUSDC.mint()`, which is
 * owner-only, so it is offered only to the wallet that deployed the token.
 */
export default function AssetWalletCard({
  account,
  networkName,
  usdcBalance,
  allowance,
  meta,
  isTokenOwner,
  onMintTestTokens,
  disabled,
  pending,
  loading,
}) {
  const [mintAmount, setMintAmount] = useState("1000");
  const { assetDecimals, assetSymbol } = meta;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Wallet</h2>
        {loading && <span className="panel-note">reading…</span>}
      </div>

      <dl className="kv">
        <div>
          <dt>Address</dt>
          <dd className="mono">{account}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{networkName || "—"}</dd>
        </div>
        <div>
          <dt>{assetSymbol} balance</dt>
          <dd className="emphasis">
            {formatAmount(usdcBalance, assetDecimals)} {assetSymbol}
          </dd>
        </div>
        <div>
          <dt>Approved to the vault</dt>
          <dd>
            {formatAmount(allowance, assetDecimals)} {assetSymbol}
            <span className="dd-note">allowance(you, vault)</span>
          </dd>
        </div>
        <div>
          <dt>Token contract</dt>
          <dd className="mono">
            <a href={`${EXPLORER_ADDRESS_BASE_URL}${USDC_ADDRESS}`} target="_blank" rel="noreferrer">
              {USDC_ADDRESS} ↗
            </a>
          </dd>
        </div>
      </dl>

      <div className="faucet">
        <div className="faucet-head">
          <span className="faucet-title">Test tokens</span>
          <span className="faucet-sub">
            {isTokenOwner
              ? `MockUSDC.mint() — owner only, and you are the owner.`
              : `MockUSDC.mint() is owner-only. Connect the wallet that deployed MockUSDC to mint.`}
          </span>
        </div>

        <div className="faucet-row">
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={mintAmount}
              onChange={(event) => setMintAmount(event.target.value)}
              disabled={disabled || pending || !isTokenOwner}
              aria-label={`Amount of ${assetSymbol} to mint`}
            />
            <span className="input-suffix">{assetSymbol}</span>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onMintTestTokens(mintAmount)}
            disabled={disabled || pending || !isTokenOwner}
          >
            {pending ? (
              <>
                <span className="spinner dark" aria-hidden="true" /> Minting...
              </>
            ) : (
              "Mint"
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
