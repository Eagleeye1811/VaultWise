import { useCallback, useEffect, useState } from "react";
import { Contract, formatEther, parseEther } from "ethers";

import Banner from "../../components/Banner";
import TransactionStatus from "../../components/TransactionStatus";
import EthVaultStats from "./EthVaultStats";
import EthDepositCard from "./EthDepositCard";
import EthWithdrawCard from "./EthWithdrawCard";

import {
  ETH_VAULT_ABI,
  ETH_VAULT_ADDRESS,
  EXPLORER_ADDRESS_BASE_URL,
  TARGET_NETWORK_NAME,
  isEthVaultConfigured,
} from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { useTransaction } from "../../hooks/useTransaction";
import { friendlyError } from "../../utils/errors";

/* ------------------------------------------------------------------ *
 * Ethers.js architecture (unchanged from Experiment 1)
 * ------------------------------------------------------------------
 *   READ   React → BrowserProvider → Contract → Blockchain
 *          (no signer, no gas, no MetaMask popup)
 *
 *   WRITE  React → BrowserProvider → Signer → MetaMask → Contract → Chain
 *          (user signs, costs gas, must be awaited with tx.wait())
 * ------------------------------------------------------------------ */

/** READ path: a provider-connected contract instance (view calls only). */
const getReadContract = (provider) =>
  new Contract(ETH_VAULT_ADDRESS, ETH_VAULT_ABI, provider);

/** WRITE path: a signer-connected contract instance (state-changing calls). */
const getWriteContract = async (provider) => {
  const signer = await provider.getSigner();
  return new Contract(ETH_VAULT_ADDRESS, ETH_VAULT_ABI, signer);
};

/** 4 decimals is plenty for a testnet demo and keeps the cards tidy. */
const formatEth = (wei) => Number(formatEther(wei)).toFixed(4);

/**
 * Experiment 1 — the original plain-ETH vault.
 *
 * Preserved exactly as it behaved when Experiment 1 shipped. It is kept
 * reachable because its contract is still deployed on Sepolia and it is the
 * clearest possible contrast with Experiment 3: this vault tracks ownership in
 * a hand-written mapping, the ERC-4626 vault tracks it in transferable shares.
 */
export default function EthVaultView({ account, isCorrectNetwork, ethBalance, refreshKey, refresh }) {
  const [walletBalance, setWalletBalance] = useState("0.0000");
  const [myVaultBalance, setMyVaultBalance] = useState("0.0000");
  const [totalVaultBalance, setTotalVaultBalance] = useState("0.0000");

  // Unrounded vault balance. The displayed value is rounded to 4 dp, and
  // rounding *up* would let "Max" ask for more than the contract holds for
  // this user — so the exact value backs Max and validation.
  const [myVaultExact, setMyVaultExact] = useState("0");

  const [loading, setLoading] = useState(false);
  const [viewError, setViewError] = useState("");

  const { tx, pendingAction, execute } = useTransaction();

  const connected = Boolean(account);
  const ready = connected && isCorrectNetwork && isEthVaultConfigured;

  /* ---------------------------------------------------------------- *
   * READS — wallet balance, my vault balance, total vault balance
   * ---------------------------------------------------------------- */
  const readVault = useCallback(async () => {
    if (!account) return;

    setWalletBalance(ethBalance === null ? "0.0000" : formatEth(ethBalance));

    if (!ready) {
      setMyVaultBalance("0.0000");
      setTotalVaultBalance("0.0000");
      setMyVaultExact("0");
      return;
    }

    setLoading(true);
    try {
      const contract = getReadContract(getProvider());

      // NOTE: we read the public `deposits` mapping rather than
      // `getMyDeposit()`. A provider-only (unsigned) call has no msg.sender,
      // so getMyDeposit() would read the zero address. The mapping getter
      // takes the address explicitly and returns exactly the same number.
      const [rawMine, rawTotal] = await Promise.all([
        contract.deposits(account),
        contract.getVaultBalance(),
      ]);

      setMyVaultBalance(formatEth(rawMine));
      setMyVaultExact(formatEther(rawMine));
      setTotalVaultBalance(formatEth(rawTotal));
      setViewError("");
    } catch (error) {
      setViewError(
        friendlyError(
          error,
          "Could not load data from the blockchain. Check the contract address and network."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [account, ethBalance, ready]);

  useEffect(() => {
    readVault();
  }, [readVault, refreshKey]);

  /* ---------------------------------------------------------------- *
   * WRITES — deposit & withdraw
   * ---------------------------------------------------------------- */
  const guard = () => {
    if (!account) return "Connect your wallet first.";
    if (!isEthVaultConfigured)
      return "No Experiment 1 address configured. Set VITE_CONTRACT_ADDRESS in frontend/.env.local.";
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    return "";
  };

  const deposit = async (amount) => {
    const problem = guard();
    if (problem) {
      setViewError(problem);
      return false;
    }
    setViewError("");

    const logSources = [
      {
        name: "VaultWiseVault",
        address: ETH_VAULT_ADDRESS,
        iface: getReadContract(getProvider()).interface,
      },
    ];

    const result = await execute({
      action: "deposit",
      send: async () => {
        const contract = await getWriteContract(getProvider());
        return contract.deposit({ value: parseEther(amount) });
      },
      pending: `Depositing ${amount} ETH. Waiting for the network to confirm...`,
      success: `Deposited ${amount} ETH into VaultWise.`,
      logSources,
    });

    if (result.ok) refresh();
    else if (result.message) setViewError(result.message);
    return result.ok;
  };

  const withdraw = async (amount) => {
    const problem = guard();
    if (problem) {
      setViewError(problem);
      return false;
    }

    // Defensive re-check against the exact on-chain balance we last read.
    if (Number(amount) > Number(myVaultExact)) {
      setViewError("You cannot withdraw more than you have deposited.");
      return false;
    }
    setViewError("");

    const logSources = [
      {
        name: "VaultWiseVault",
        address: ETH_VAULT_ADDRESS,
        iface: getReadContract(getProvider()).interface,
      },
    ];

    const result = await execute({
      action: "withdraw",
      send: async () => {
        const contract = await getWriteContract(getProvider());
        return contract.withdraw(parseEther(amount));
      },
      pending: `Withdrawing ${amount} ETH. Waiting for the network to confirm...`,
      success: `Withdrew ${amount} ETH from VaultWise.`,
      logSources,
    });

    if (result.ok) refresh();
    else if (result.message) setViewError(result.message);
    return result.ok;
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  return (
    <>
      <section className="hero">
        <span className="hero-eyebrow">Experiment 1</span>
        <h1>ETH Vault</h1>
        <p>
          The vault that started VaultWise: deposit native ETH, and the contract remembers
          your balance in a hand-written mapping. No tokens, no shares.
        </p>
      </section>

      {!isEthVaultConfigured && (
        <Banner tone="warn">
          <strong>Experiment 1 address not set.</strong> Deploy{" "}
          <code>contracts/experiment1/VaultWiseVault.sol</code>, then set{" "}
          <code>VITE_CONTRACT_ADDRESS</code> in <code>frontend/.env.local</code>.
        </Banner>
      )}

      {viewError && (
        <Banner tone="error" onDismiss={() => setViewError("")}>
          {viewError}
        </Banner>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Contract</h2>
        </div>
        <dl className="kv">
          <div>
            <dt>Vault contract</dt>
            <dd className="mono">
              {isEthVaultConfigured ? (
                <a
                  href={`${EXPLORER_ADDRESS_BASE_URL}${ETH_VAULT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ETH_VAULT_ADDRESS} ↗
                </a>
              ) : (
                "not configured"
              )}
            </dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd>Native ETH (18 decimals)</dd>
          </div>
          <div>
            <dt>Ownership record</dt>
            <dd>
              <code>mapping(address =&gt; uint256) deposits</code> — not a token, not
              transferable
            </dd>
          </div>
        </dl>
      </section>

      <EthVaultStats
        walletBalance={walletBalance}
        myVaultBalance={myVaultBalance}
        totalVaultBalance={totalVaultBalance}
        loading={loading}
        connected={connected}
      />

      <div className="cards-grid">
        <EthDepositCard
          onDeposit={deposit}
          walletBalance={walletBalance}
          disabled={!ready}
          pending={pendingAction === "deposit"}
        />
        <EthWithdrawCard
          onWithdraw={withdraw}
          myVaultBalance={myVaultBalance}
          myVaultExact={myVaultExact}
          disabled={!ready}
          pending={pendingAction === "withdraw"}
        />
      </div>

      <TransactionStatus tx={tx} decimals={18} />
    </>
  );
}
