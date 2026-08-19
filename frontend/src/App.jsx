import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

import Navbar from "./components/Navbar";
import VaultStats from "./components/VaultStats";
import DepositCard from "./components/DepositCard";
import WithdrawCard from "./components/WithdrawCard";
import TransactionStatus from "./components/TransactionStatus";

import {
  CONTRACT_ABI,
  CONTRACT_ADDRESS,
  TARGET_CHAIN_ID,
  TARGET_NETWORK_NAME,
  isContractConfigured,
} from "./contracts/contractConfig";
import { friendlyError } from "./utils/errors";

/* ------------------------------------------------------------------ *
 * Ethers.js architecture used in this file
 * ------------------------------------------------------------------
 *   READ   React → BrowserProvider → Contract → Blockchain
 *          (no signer, no gas, no MetaMask popup)
 *
 *   WRITE  React → BrowserProvider → Signer → MetaMask → Contract → Chain
 *          (user signs, costs gas, must be awaited with tx.wait())
 *
 * The two helpers below keep that distinction explicit.
 * ------------------------------------------------------------------ */

/** Is the MetaMask (or any EIP-1193) provider injected in this browser? */
const hasMetaMask = () =>
  typeof window !== "undefined" && typeof window.ethereum !== "undefined";

/** READ path: a provider-connected contract instance (view calls only). */
const getReadContract = (provider) =>
  new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

/** WRITE path: a signer-connected contract instance (state-changing calls). */
const getWriteContract = async (provider) => {
  const signer = await provider.getSigner();
  return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
};

/** 4 decimals is plenty for a testnet demo and keeps the cards tidy. */
const formatEth = (wei) => Number(formatEther(wei)).toFixed(4);

const IDLE_TX = { status: "idle", hash: null, message: "" };

export default function App() {
  // ── wallet / network ────────────────────────────────────────────────
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null); // bigint | null
  const [networkName, setNetworkName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  // ── on-chain numbers (already formatted as ETH strings) ─────────────
  const [walletBalance, setWalletBalance] = useState("0.0000");
  const [myVaultBalance, setMyVaultBalance] = useState("0.0000");
  const [totalVaultBalance, setTotalVaultBalance] = useState("0.0000");
  const [loadingStats, setLoadingStats] = useState(false);

  // Unrounded vault balance (full 18-decimal string). The displayed value is
  // rounded to 4 dp, and rounding *up* would let "Max" ask for more than the
  // contract holds for this user — so the exact value backs Max + validation.
  const [myVaultExact, setMyVaultExact] = useState("0");

  // Mirrors `account` so event listeners registered once on mount can read the
  // current account without being re-registered (and without stale closures).
  const accountRef = useRef(null);

  // ── transactions & errors ───────────────────────────────────────────
  const [tx, setTx] = useState(IDLE_TX);
  const [pendingAction, setPendingAction] = useState(null); // "deposit" | "withdraw" | null
  const [appError, setAppError] = useState("");

  const isCorrectNetwork = chainId !== null && chainId === TARGET_CHAIN_ID;

  /** Single place that updates both the account state and its ref. */
  const applyAccount = useCallback((address) => {
    accountRef.current = address;
    setAccount(address);
  }, []);

  /** Reset every on-chain number back to zero (disconnect / wrong network). */
  const clearBalances = useCallback(() => {
    setWalletBalance("0.0000");
    setMyVaultBalance("0.0000");
    setTotalVaultBalance("0.0000");
    setMyVaultExact("0");
  }, []);

  /* ---------------------------------------------------------------- *
   * READS — wallet balance, my vault balance, total vault balance
   * ---------------------------------------------------------------- */
  const refreshData = useCallback(async (address) => {
    if (!address || !hasMetaMask()) return;

    setLoadingStats(true);
    try {
      const provider = new BrowserProvider(window.ethereum);

      // Network first — the contract reads below are meaningless on the
      // wrong chain, so we record it and skip them if we are not on Sepolia.
      const network = await provider.getNetwork();
      setChainId(network.chainId);
      setNetworkName(
        network.chainId === TARGET_CHAIN_ID
          ? TARGET_NETWORK_NAME
          : network.name && network.name !== "unknown"
            ? `${network.name} (chain ${network.chainId})`
            : `Chain ${network.chainId}`
      );

      // 1. Plain ETH balance of the connected account.
      const rawWallet = await provider.getBalance(address);
      setWalletBalance(formatEth(rawWallet));

      // 2 & 3. Contract reads — only if we have an address AND are on Sepolia.
      if (!isContractConfigured || network.chainId !== TARGET_CHAIN_ID) {
        setMyVaultBalance("0.0000");
        setTotalVaultBalance("0.0000");
        setMyVaultExact("0");
        return;
      }

      const contract = getReadContract(provider);

      // NOTE: we read the public `deposits` mapping rather than
      // `getMyDeposit()`. A provider-only (unsigned) call has no msg.sender,
      // so getMyDeposit() would read the zero address. The mapping getter
      // takes the address explicitly and returns exactly the same number.
      const [rawMine, rawTotal] = await Promise.all([
        contract.deposits(address),
        contract.getVaultBalance(),
      ]);

      setMyVaultBalance(formatEth(rawMine));
      setMyVaultExact(formatEther(rawMine));
      setTotalVaultBalance(formatEth(rawTotal));
    } catch (error) {
      setAppError(
        friendlyError(
          error,
          "Could not load data from the blockchain. Check the contract address and network."
        )
      );
    } finally {
      setLoadingStats(false);
    }
  }, []);

  /* ---------------------------------------------------------------- *
   * Wallet connection
   * ---------------------------------------------------------------- */
  const connectWallet = useCallback(async () => {
    setAppError("");

    if (!hasMetaMask()) {
      setAppError(
        "MetaMask was not detected. Install the MetaMask browser extension from metamask.io, then reload this page."
      );
      return;
    }

    setIsConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);

      if (!accounts || accounts.length === 0) {
        setAppError("No account was returned by MetaMask. Unlock your wallet and try again.");
        return;
      }

      applyAccount(accounts[0]);
      await refreshData(accounts[0]);
    } catch (error) {
      setAppError(friendlyError(error, "Could not connect to MetaMask."));
    } finally {
      setIsConnecting(false);
    }
  }, [refreshData, applyAccount]);

  /* ---------------------------------------------------------------- *
   * On mount: silently restore an already-authorised account, then
   * subscribe to account / network changes.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!hasMetaMask()) {
      setAppError(
        "MetaMask was not detected. Install the MetaMask browser extension from metamask.io, then reload this page."
      );
      return;
    }

    // `eth_accounts` does NOT open a popup — it just reports whether this
    // site was already approved in a previous session.
    (async () => {
      try {
        const provider = new BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_accounts", []);
        if (accounts && accounts.length > 0) {
          applyAccount(accounts[0]);
          await refreshData(accounts[0]);
        } else {
          // Still show which network the user is on before connecting.
          const network = await provider.getNetwork();
          setChainId(network.chainId);
        }
      } catch (error) {
        console.error("[VaultWise] initial wallet check failed", error);
      }
    })();

    const handleAccountsChanged = (accounts) => {
      setTx(IDLE_TX);
      setAppError("");
      if (!accounts || accounts.length === 0) {
        // User disconnected the site from inside MetaMask.
        applyAccount(null);
        clearBalances();
        return;
      }
      applyAccount(accounts[0]);
      refreshData(accounts[0]); // reload blockchain data for the new account
    };

    const handleChainChanged = (hexChainId) => {
      setAppError("");
      setTx(IDLE_TX);
      setChainId(BigInt(hexChainId));
      // Re-read everything on the new chain for the account we already have.
      if (accountRef.current) refreshData(accountRef.current);
      else clearBalances();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshData, applyAccount, clearBalances]);

  /* ---------------------------------------------------------------- *
   * WRITES — deposit & withdraw
   * ---------------------------------------------------------------- */

  /** Shared guard for both write paths. Returns an error string, or "". */
  const writeGuard = () => {
    if (!hasMetaMask()) return "MetaMask was not detected.";
    if (!account) return "Connect your wallet first.";
    if (!isContractConfigured)
      return "No contract address configured. Deploy VaultWiseVault.sol in Remix and paste the address into src/contracts/contractConfig.js.";
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    return "";
  };

  const deposit = async (amount) => {
    const guard = writeGuard();
    if (guard) {
      setAppError(guard);
      return false;
    }

    setAppError("");
    setPendingAction("deposit");
    setTx({ status: "pending", hash: null, message: "Waiting for you to confirm in MetaMask..." });

    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = await getWriteContract(provider);

      // Send the transaction — MetaMask pops up here.
      const transaction = await contract.deposit({ value: parseEther(amount) });

      setTx({
        status: "pending",
        hash: transaction.hash,
        message: `Depositing ${amount} ETH. Waiting for the network to confirm...`,
      });

      const receipt = await transaction.wait();

      if (receipt && receipt.status === 0) {
        setTx({
          status: "failed",
          hash: transaction.hash,
          message: "The transaction was mined but reverted.",
        });
        return false;
      }

      setTx({
        status: "confirmed",
        hash: transaction.hash,
        message: `Deposited ${amount} ETH into VaultWise.`,
      });

      await refreshData(account); // refresh wallet + my vault + total vault
      return true;
    } catch (error) {
      const message = friendlyError(error, "The deposit could not be completed.");
      setAppError(message);
      setTx({ status: "failed", hash: error?.transaction?.hash ?? null, message });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const withdraw = async (amount) => {
    const guard = writeGuard();
    if (guard) {
      setAppError(guard);
      return false;
    }

    // Defensive re-check against the exact on-chain balance we last read.
    if (Number(amount) > Number(myVaultExact)) {
      setAppError("You cannot withdraw more than you have deposited.");
      return false;
    }

    setAppError("");
    setPendingAction("withdraw");
    setTx({ status: "pending", hash: null, message: "Waiting for you to confirm in MetaMask..." });

    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = await getWriteContract(provider);

      const transaction = await contract.withdraw(parseEther(amount));

      setTx({
        status: "pending",
        hash: transaction.hash,
        message: `Withdrawing ${amount} ETH. Waiting for the network to confirm...`,
      });

      const receipt = await transaction.wait();

      if (receipt && receipt.status === 0) {
        setTx({
          status: "failed",
          hash: transaction.hash,
          message: "The transaction was mined but reverted.",
        });
        return false;
      }

      setTx({
        status: "confirmed",
        hash: transaction.hash,
        message: `Withdrew ${amount} ETH from VaultWise.`,
      });

      await refreshData(account);
      return true;
    } catch (error) {
      const message = friendlyError(error, "The withdrawal could not be completed.");
      setAppError(message);
      setTx({ status: "failed", hash: error?.transaction?.hash ?? null, message });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  const connected = Boolean(account);
  const actionsDisabled = !connected || !isCorrectNetwork || !isContractConfigured;

  return (
    <div className="app">
      <Navbar
        account={account}
        networkName={networkName}
        isCorrectNetwork={isCorrectNetwork}
        isConnecting={isConnecting}
        onConnect={connectWallet}
      />

      <main className="container">
        <section className="hero">
          <h1>VaultWise</h1>
          <p>Your simple decentralized asset vault</p>
        </section>

        {/* ── banners ─────────────────────────────────────────────── */}
        {!isContractConfigured && (
          <div className="banner banner-warn">
            <strong>Contract address not set.</strong> Deploy{" "}
            <code>contracts/VaultWiseVault.sol</code> in Remix, then paste the address
            into <code>frontend/src/contracts/contractConfig.js</code> (or into{" "}
            <code>frontend/.env.local</code> as <code>VITE_CONTRACT_ADDRESS</code>).
          </div>
        )}

        {connected && !isCorrectNetwork && (
          <div className="banner banner-warn">
            Please switch MetaMask to {TARGET_NETWORK_NAME}.
          </div>
        )}

        {appError && (
          <div className="banner banner-error">
            <span>{appError}</span>
            <button className="banner-close" onClick={() => setAppError("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {/* ── wallet information ──────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <h2>Wallet Information</h2>
          </div>
          {connected ? (
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
                <dt>Vault contract</dt>
                <dd className="mono">
                  {isContractConfigured ? CONTRACT_ADDRESS : "not configured"}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="empty">
              <p>No wallet connected.</p>
              <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            </div>
          )}
        </section>

        {/* ── statistics ──────────────────────────────────────────── */}
        <VaultStats
          walletBalance={walletBalance}
          myVaultBalance={myVaultBalance}
          totalVaultBalance={totalVaultBalance}
          loading={loadingStats}
          connected={connected}
        />

        {/* ── actions ─────────────────────────────────────────────── */}
        <div className="cards-grid">
          <DepositCard
            onDeposit={deposit}
            walletBalance={walletBalance}
            disabled={actionsDisabled}
            pending={pendingAction === "deposit"}
          />
          <WithdrawCard
            onWithdraw={withdraw}
            myVaultBalance={myVaultBalance}
            myVaultExact={myVaultExact}
            disabled={actionsDisabled}
            pending={pendingAction === "withdraw"}
          />
        </div>

        {/* ── transaction status ──────────────────────────────────── */}
        <TransactionStatus tx={tx} />
      </main>

      <footer className="footer">
        VaultWise · Experiment 1 — React + Ethers.js DApp · Sepolia testnet only, never
        use real funds
      </footer>
    </div>
  );
}
