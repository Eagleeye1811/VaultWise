import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider } from "ethers";

import { TARGET_CHAIN_ID, TARGET_NETWORK_NAME } from "../contracts/contractConfig";
import { friendlyError } from "../utils/errors";

/**
 * Everything to do with MetaMask, in one place.
 *
 * This was lifted out of Experiment 1's `App.jsx` when Experiment 3 was added,
 * because both experiments need exactly the same wallet behaviour — connect,
 * silent reconnect, live account switching, live network switching — and
 * duplicating it would have guaranteed the two copies drifted apart.
 *
 * The behaviour itself is unchanged from Experiment 1.
 */

/** Is an EIP-1193 provider (MetaMask) injected in this browser? */
export const hasMetaMask = () =>
  typeof window !== "undefined" && typeof window.ethereum !== "undefined";

const NO_METAMASK =
  "MetaMask was not detected. Install the MetaMask browser extension from metamask.io, then reload this page.";

/** A fresh provider per call — MetaMask can swap its underlying network. */
export const getProvider = () => new BrowserProvider(window.ethereum);

/** Human label for a chain id we may or may not recognise. */
function describeNetwork(chainId, fallbackName) {
  if (chainId === null) return "";
  if (chainId === TARGET_CHAIN_ID) return TARGET_NETWORK_NAME;
  if (fallbackName && fallbackName !== "unknown")
    return `${fallbackName} (chain ${chainId})`;
  return `Chain ${chainId}`;
}

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null); // bigint | null
  const [networkName, setNetworkName] = useState("");
  const [ethBalance, setEthBalance] = useState(null); // bigint | null
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");

  /**
   * Bumped whenever something happened that could have changed on-chain state
   * (a confirmed transaction, an account switch). Views watch it and re-read.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  // Mirrors `account` so the listeners registered once on mount can read the
  // current account without stale closures and without re-subscribing.
  const accountRef = useRef(null);

  const applyAccount = useCallback((address) => {
    accountRef.current = address;
    setAccount(address);
  }, []);

  /** Re-read the chain id and the account's native ETH balance. */
  const readChainState = useCallback(async (address) => {
    if (!hasMetaMask()) return;
    try {
      const provider = getProvider();
      const network = await provider.getNetwork();

      setChainId(network.chainId);
      setNetworkName(describeNetwork(network.chainId, network.name));

      setEthBalance(address ? await provider.getBalance(address) : null);
    } catch (error) {
      console.error("[VaultWise] could not read chain state", error);
    }
  }, []);

  /** Opens the MetaMask popup and asks for account access. */
  const connect = useCallback(async () => {
    setWalletError("");

    if (!hasMetaMask()) {
      setWalletError(NO_METAMASK);
      return;
    }

    setIsConnecting(true);
    try {
      const provider = getProvider();
      const accounts = await provider.send("eth_requestAccounts", []);

      if (!accounts || accounts.length === 0) {
        setWalletError("No account was returned by MetaMask. Unlock your wallet and try again.");
        return;
      }

      applyAccount(accounts[0]);
      await readChainState(accounts[0]);
      refresh();
    } catch (error) {
      setWalletError(friendlyError(error, "Could not connect to MetaMask."));
    } finally {
      setIsConnecting(false);
    }
  }, [applyAccount, readChainState, refresh]);

  /**
   * Ask MetaMask to switch to the target network. Only ever called from a
   * button the user clicks, and MetaMask shows its own approval prompt — the
   * app never changes networks on its own. The `chainChanged` listener below
   * picks up the result.
   */
  const switchToTargetNetwork = useCallback(async () => {
    setWalletError("");
    if (!hasMetaMask()) {
      setWalletError(NO_METAMASK);
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${TARGET_CHAIN_ID.toString(16)}` }],
      });
    } catch (error) {
      setWalletError(friendlyError(error, `Could not switch MetaMask to ${TARGET_NETWORK_NAME}.`));
    }
  }, []);

  /* ---------------------------------------------------------------- *
   * Mount: silently restore an already-approved account, then listen.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!hasMetaMask()) {
      setWalletError(NO_METAMASK);
      return undefined;
    }

    // `eth_accounts` never opens a popup — it only reports whether this site
    // was already approved in an earlier session.
    (async () => {
      try {
        const provider = getProvider();
        const accounts = await provider.send("eth_accounts", []);

        if (accounts && accounts.length > 0) {
          applyAccount(accounts[0]);
          await readChainState(accounts[0]);
          refresh();
        } else {
          // Still show which network the user is on before they connect.
          await readChainState(null);
        }
      } catch (error) {
        console.error("[VaultWise] initial wallet check failed", error);
      }
    })();

    const handleAccountsChanged = (accounts) => {
      setWalletError("");

      if (!accounts || accounts.length === 0) {
        // The site was disconnected from inside MetaMask.
        applyAccount(null);
        setEthBalance(null);
        refresh();
        return;
      }

      applyAccount(accounts[0]);
      readChainState(accounts[0]);
      refresh();
    };

    const handleChainChanged = (hexChainId) => {
      setWalletError("");
      setChainId(BigInt(hexChainId));
      readChainState(accountRef.current);
      refresh();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [applyAccount, readChainState, refresh]);

  // Keep the native balance fresh after transactions spend gas.
  useEffect(() => {
    if (account) readChainState(account);
    // `refreshKey` is the trigger; readChainState is stable.
  }, [account, refreshKey, readChainState]);

  return {
    hasWallet: hasMetaMask(),
    account,
    chainId,
    networkName,
    ethBalance,
    isCorrectNetwork: chainId !== null && chainId === TARGET_CHAIN_ID,
    isConnecting,
    walletError,
    setWalletError,
    connect,
    switchToTargetNetwork,
    refresh,
    refreshKey,
  };
}
