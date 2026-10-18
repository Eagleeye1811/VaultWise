import { useState } from "react";

import { EXPLORER_ADDRESS_BASE_URL } from "../../contracts/contractConfig";
import { formatAmount } from "../../utils/format";

/**
 * The connected wallet as the pool sees it: balances of both tokens, the
 * current allowance to the pool, and links to the three contracts.
 *
 * The lab controls wrap `MockERC20.mint()`, which is owner-only:
 *   - mint test staking tokens to yourself (staking-token owner)
 *   - fund the pool by minting RWD to its address (RWD owner) — the sheet's
 *     "mint sufficient RWD directly to the contract" step
 */
export default function StakeWalletCard({
  pool,
  meta,
  data,
  account,
  networkName,
  isCorrectNetwork,
  isOwner,
  onMint,
  disabled,
  busy,
  pendingAction,
  loading,
}) {
  const [mintAmount, setMintAmount] = useState("100");
  const [fundAmount, setFundAmount] = useState("1000");
  const { stake, reward } = meta;

  const spinner = (label) => (
    <>
      <span className="spinner dark" aria-hidden="true" /> {label}
    </>
  );

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
        <div>
          <dt>{stake.symbol} balance</dt>
          <dd className="emphasis">
            {formatAmount(data.walletStake, stake.decimals, 4)} {stake.symbol}
            <span className="dd-note">
              {stake.decimals} decimals · approved to {pool.noun}: {formatAmount(data.allowance, stake.decimals, 4)}
            </span>
            {data.walletStake === 0n && data.staked > 0n && (
              <span className="dd-note">
                your {formatAmount(data.staked, stake.decimals, 4)} {stake.symbol} is staked in the {pool.noun}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{reward.symbol} balance</dt>
          <dd className="emphasis">
            {formatAmount(data.walletReward, reward.decimals, 6)} {reward.symbol}
            <span className="dd-note">rewards already paid to this wallet</span>
          </dd>
        </div>
        <div>
          <dt>Contracts</dt>
          <dd className="mono contract-links">
            {[
              [`${stake.symbol} (MockERC20)`, pool.address.stake],
              [`${reward.symbol} (MockERC20)`, pool.address.reward],
              [pool.contractName, pool.address.pool],
            ].map(([label, address]) => (
              <a key={label} href={`${EXPLORER_ADDRESS_BASE_URL}${address}`} target="_blank" rel="noreferrer">
                {label}: {address || "not set"} ↗
              </a>
            ))}
          </dd>
        </div>
      </dl>

      <div className="faucet">
        <div className="faucet-head">
          <span className="faucet-title">
            Lab setup <span className="kind kind-tx">tx</span>
          </span>
          <span className="faucet-sub">
            MockERC20.mint() is owner-only.{" "}
            {isOwner.stake || isOwner.reward
              ? "You deployed at least one of these tokens."
              : `Connect the wallet that deployed ${stake.symbol}/${reward.symbol} to mint or fund.`}
          </span>
        </div>

        <div className="faucet-row">
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={mintAmount}
              onChange={(event) => setMintAmount(event.target.value)}
              disabled={disabled || busy || !isOwner.stake}
              aria-label={`Amount of ${stake.symbol} to mint to your wallet`}
            />
            <span className="input-suffix">{stake.symbol}</span>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onMint("stake", mintAmount)}
            disabled={disabled || busy || !isOwner.stake}
          >
            {pendingAction === "mint-stake" ? spinner("Minting...") : `Mint ${stake.symbol} to me`}
          </button>
        </div>

        <div className="faucet-row">
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={fundAmount}
              onChange={(event) => setFundAmount(event.target.value)}
              disabled={disabled || busy || !isOwner.reward}
              aria-label={`Amount of ${reward.symbol} to fund the ${pool.noun} with`}
            />
            <span className="input-suffix">{reward.symbol}</span>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onMint("reward", fundAmount)}
            disabled={disabled || busy || !isOwner.reward}
          >
            {pendingAction === "mint-reward" ? spinner("Funding...") : `Fund ${pool.contractName}`}
          </button>
        </div>
      </div>
    </section>
  );
}
