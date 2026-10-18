import { useState } from "react";

import {
  AMM_ADDRESS,
  EXPLORER_ADDRESS_BASE_URL,
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
} from "../../contracts/contractConfig";
import { formatAmount } from "../../utils/format";

/**
 * The connected wallet as the pool sees it: account and network, TKA/TKB
 * balances, what the pool is currently allowed to pull of each, and links to
 * the three contracts.
 *
 * The mint controls wrap `MockERC20.mint()`, which is owner-only, so each one
 * is enabled only for the wallet that deployed that token.
 */
export default function PoolWalletCard({
  account,
  networkName,
  isCorrectNetwork,
  data,
  meta,
  isOwner,
  onMint,
  disabled,
  busy,
  pendingAction,
  loading,
}) {
  const [mintAmount, setMintAmount] = useState("1000");

  const sides = [
    { side: "A", balance: data.balanceA, allowance: data.allowanceA, address: TOKEN_A_ADDRESS },
    { side: "B", balance: data.balanceB, allowance: data.allowanceB, address: TOKEN_B_ADDRESS },
  ];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Wallet</h2>
        {loading && <span className="panel-note">reading…</span>}
      </div>

      <dl className="kv">
        <div>
          <dt>Account</dt>
          <dd className="mono">{account}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>
            {networkName || "—"}
            {!isCorrectNetwork && <span className="dd-note warn-text">wrong network — switch to Sepolia</span>}
          </dd>
        </div>

        {sides.map(({ side, balance, allowance }) => (
          <div key={side}>
            <dt>{meta[side].symbol} balance</dt>
            <dd className="emphasis">
              {formatAmount(balance, meta[side].decimals, 4)} {meta[side].symbol}
              <span className="dd-note">
                {meta[side].decimals} decimals · approved to pool:{" "}
                {formatAmount(allowance, meta[side].decimals, 4)}
              </span>
              {balance === 0n && data.lpBalance > 0n && (
                <span className="dd-note warn-text">
                  0 in wallet — your {meta[side].symbol} is in the pool as liquidity
                </span>
              )}
            </dd>
          </div>
        ))}

        <div>
          <dt>Contracts</dt>
          <dd className="mono contract-links">
            {[
              [meta.A.symbol, TOKEN_A_ADDRESS],
              [meta.B.symbol, TOKEN_B_ADDRESS],
              ["SimpleAMM", AMM_ADDRESS],
            ].map(([label, address]) => (
              <a
                key={label}
                href={`${EXPLORER_ADDRESS_BASE_URL}${address}`}
                target="_blank"
                rel="noreferrer"
              >
                {label}: {address || "not set"} ↗
              </a>
            ))}
          </dd>
        </div>
      </dl>

      <div className="faucet">
        <div className="faucet-head">
          <span className="faucet-title">
            Test tokens <span className="kind kind-tx">tx</span>
          </span>
          <span className="faucet-sub">
            MockERC20.mint() is owner-only.{" "}
            {isOwner.A || isOwner.B
              ? "You deployed at least one of these tokens."
              : "Connect the wallet that deployed TKA/TKB to mint."}
          </span>
        </div>

        <div className="faucet-row">
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={mintAmount}
              onChange={(event) => setMintAmount(event.target.value)}
              disabled={disabled || busy || !(isOwner.A || isOwner.B)}
              aria-label="Amount of test tokens to mint"
            />
          </div>
          {sides.map(({ side }) => (
            <button
              key={side}
              type="button"
              className="btn btn-outline"
              onClick={() => onMint(side, mintAmount)}
              disabled={disabled || busy || !isOwner[side]}
            >
              {pendingAction === `faucet-${side}` ? (
                <>
                  <span className="spinner dark" aria-hidden="true" /> Minting...
                </>
              ) : (
                `Mint ${meta[side].symbol}`
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
