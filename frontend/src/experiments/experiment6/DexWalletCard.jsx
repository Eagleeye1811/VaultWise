import { useState } from "react";

import {
  DEX_FACTORY_ADDRESS,
  DEX_ROUTER_ADDRESS,
  DEX_TOKEN_ADDRESSES,
  EXPLORER_ADDRESS_BASE_URL,
} from "../../contracts/contractConfig";
import { formatAmount } from "../../utils/format";
import { TOKEN_KEYS } from "./dex";

/**
 * The connected wallet as the DEX sees it: each demo token's balance and its
 * current allowance to the Router (the only spender users ever approve), links
 * to every contract, and a faucet — DexMockERC20.mint is public, so any wallet
 * can mint test tokens.
 */
export default function DexWalletCard({ tokens, symbols, account, networkName, isCorrectNetwork, onMint, disabled, busy, pendingAction, loading }) {
  const [amount, setAmount] = useState("1000");

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
        {TOKEN_KEYS.map((key) => (
          <div key={key}>
            <dt>{symbols[key]} balance</dt>
            <dd className="emphasis">
              {formatAmount(tokens[key].balance, tokens[key].decimals, 4)} {symbols[key]}
              <span className="dd-note">
                {tokens[key].decimals} decimals · approved to Router: {formatAmount(tokens[key].allowance, tokens[key].decimals, 4)}
              </span>
            </dd>
          </div>
        ))}
        <div>
          <dt>Contracts</dt>
          <dd className="mono contract-links">
            {[
              ["Factory", DEX_FACTORY_ADDRESS],
              ["Router", DEX_ROUTER_ADDRESS],
              ...TOKEN_KEYS.map((key) => [symbols[key], DEX_TOKEN_ADDRESSES[key]]),
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
            Test tokens <span className="kind kind-tx">tx</span>
          </span>
          <span className="faucet-sub">DexMockERC20.mint() is public — any wallet can mint demo tokens.</span>
        </div>
        <div className="faucet-row">
          <div className="input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={disabled || busy}
              aria-label="Amount of test tokens to mint"
            />
          </div>
          {TOKEN_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="btn btn-outline"
              onClick={() => onMint(key, amount)}
              disabled={disabled || busy}
            >
              {pendingAction === `mint-${key}` ? (
                <>
                  <span className="spinner dark" aria-hidden="true" /> Minting...
                </>
              ) : (
                `Mint ${symbols[key]}`
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
