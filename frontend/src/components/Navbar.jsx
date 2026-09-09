import { EXPERIMENTS } from "../contracts/contractConfig";
import { shortAddress } from "../utils/format";

/**
 * Top navigation bar: brand, the experiment switcher, network pill and wallet.
 *
 * Purely presentational — every piece of wallet logic lives in `useWallet`.
 * The experiment switcher was added in Experiment 3 so the original ETH vault
 * stays reachable instead of being thrown away.
 */
export default function Navbar({
  account,
  networkName,
  isCorrectNetwork,
  isConnecting,
  onConnect,
  activeExperiment,
  onSelectExperiment,
}) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a
          className="brand"
          href={`#/${EXPERIMENTS[0].slug}`}
          onClick={() => onSelectExperiment(EXPERIMENTS[0].slug)}
        >
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-text">
            <span className="brand-name">VaultWise</span>
            <span className="brand-tag">DeFi vault lab</span>
          </span>
        </a>

        <nav className="experiment-switch" aria-label="Experiments">
          {EXPERIMENTS.map((experiment) => (
            <button
              key={experiment.id}
              type="button"
              className={`switch-tab ${activeExperiment === experiment.slug ? "active" : ""}`}
              onClick={() => onSelectExperiment(experiment.slug)}
              aria-current={activeExperiment === experiment.slug ? "page" : undefined}
              title={experiment.blurb}
            >
              <span className="switch-num">{experiment.number}</span>
              <span className="switch-label">{experiment.short}</span>
            </button>
          ))}
        </nav>

        <div className="navbar-right">
          {networkName && (
            <span
              className={`network-pill ${isCorrectNetwork ? "ok" : "warn"}`}
              title={`Connected network: ${networkName}`}
            >
              <span className="dot" aria-hidden="true" />
              {networkName}
            </span>
          )}

          {account ? (
            <span className="wallet-pill" title={account}>
              <span className="dot ok" aria-hidden="true" />
              {shortAddress(account, 5, 4)}
            </span>
          ) : (
            <button className="btn btn-primary" onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
