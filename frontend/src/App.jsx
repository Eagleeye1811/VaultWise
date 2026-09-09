import { useCallback, useEffect, useState } from "react";

import Navbar from "./components/Navbar";
import Banner from "./components/Banner";
import Footer from "./components/Footer";

import EthVaultView from "./experiments/experiment1/EthVaultView";
import Erc4626View from "./experiments/experiment3/Erc4626View";

import {
  DEFAULT_EXPERIMENT,
  EXPERIMENTS,
  TARGET_NETWORK_NAME,
} from "./contracts/contractConfig";
import { useWallet } from "./hooks/useWallet";

/**
 * VaultWise — application shell.
 *
 * Owns exactly two things: the wallet connection (shared by every experiment)
 * and which experiment is on screen. All contract interaction lives inside the
 * experiment views, so adding Experiment 4 later means adding one view and one
 * entry in the EXPERIMENTS registry — not editing this file's logic.
 *
 * Routing is a hash route (`#/experiment-3`) rather than a router dependency:
 * it survives a reload, it is linkable, and it costs nothing.
 */

const VALID_SLUGS = new Set(EXPERIMENTS.map((experiment) => experiment.slug));

/** Read the experiment slug out of `location.hash`, falling back to default. */
function readHash() {
  const slug = window.location.hash.replace(/^#\/?/, "");
  return VALID_SLUGS.has(slug) ? slug : DEFAULT_EXPERIMENT;
}

export default function App() {
  const {
    hasWallet,
    account,
    networkName,
    ethBalance,
    isCorrectNetwork,
    isConnecting,
    walletError,
    setWalletError,
    connect,
    refresh,
    refreshKey,
  } = useWallet();

  const [experiment, setExperiment] = useState(readHash);

  // Keep the hash and the view in step, in both directions.
  useEffect(() => {
    const onHashChange = () => setExperiment(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectExperiment = useCallback((slug) => {
    window.location.hash = `#/${slug}`;
    setExperiment(slug);
  }, []);

  const connected = Boolean(account);

  return (
    <div className="app">
      <Navbar
        account={account}
        networkName={networkName}
        isCorrectNetwork={isCorrectNetwork}
        isConnecting={isConnecting}
        onConnect={connect}
        activeExperiment={experiment}
        onSelectExperiment={selectExperiment}
      />

      <main className="container">
        {/* ── wallet-level banners, shared by every experiment ──────── */}
        {!hasWallet && (
          <Banner tone="error">
            MetaMask was not detected. Install the MetaMask browser extension from{" "}
            <a href="https://metamask.io" target="_blank" rel="noreferrer">
              metamask.io
            </a>
            , then reload this page.
          </Banner>
        )}

        {connected && !isCorrectNetwork && (
          <Banner tone="warn">
            Please switch MetaMask to {TARGET_NETWORK_NAME}. VaultWise never switches
            networks for you.
          </Banner>
        )}

        {walletError && (
          <Banner tone="error" onDismiss={() => setWalletError("")}>
            {walletError}
          </Banner>
        )}

        {!connected && hasWallet && (
          <section className="panel connect-panel">
            <div className="empty">
              <h2>Connect your wallet to begin</h2>
              <p>
                VaultWise reads and writes on {TARGET_NETWORK_NAME}. Nothing happens until
                you approve it in MetaMask.
              </p>
              <button className="btn btn-primary" onClick={connect} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            </div>
          </section>
        )}

        {/* ── the active experiment ─────────────────────────────────── */}
        {experiment === "experiment-1" ? (
          <EthVaultView
            account={account}
            isCorrectNetwork={isCorrectNetwork}
            ethBalance={ethBalance}
            refreshKey={refreshKey}
            refresh={refresh}
          />
        ) : (
          <Erc4626View
            account={account}
            networkName={networkName}
            isCorrectNetwork={isCorrectNetwork}
            refreshKey={refreshKey}
            refresh={refresh}
          />
        )}
      </main>

      <Footer activeExperiment={experiment} />
    </div>
  );
}
