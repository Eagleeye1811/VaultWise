import { useCallback, useEffect, useState } from "react";

import Banner from "../../components/Banner";
import TransactionStatus from "../../components/TransactionStatus";

import AssetWalletCard from "./AssetWalletCard";
import ConversionPanel from "./ConversionPanel";
import DepositPanel from "./DepositPanel";
import Erc4626Stats from "./Erc4626Stats";
import VaultProfileCard from "./VaultProfileCard";
import WithdrawPanel from "./WithdrawPanel";

import {
  TARGET_NETWORK_NAME,
  VAULT_4626_ADDRESS,
  isErc4626Configured,
} from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { useTransaction } from "../../hooks/useTransaction";
import { friendlyError } from "../../utils/errors";
import { formatAmount, parseAmount } from "../../utils/format";
import {
  getUsdcRead,
  getUsdcWrite,
  getVaultRead,
  getVaultWrite,
  logSources,
} from "./contracts";

/**
 * Experiment 3 — the ERC-4626 tokenized vault.
 *
 * Reading strategy: every number on this screen comes from a view call, and
 * they are fetched together so the screen can never show a share balance from
 * one block next to a total supply from another.
 *
 * Decimals are read from the contracts rather than assumed. MockUSDC uses 6,
 * but nothing here would break if the underlying asset were swapped for an
 * 18-decimal token — which is the correctness property the standard is
 * supposed to give you.
 */

const EMPTY_DATA = {
  usdcBalance: null,
  shareBalance: null,
  allowance: null,
  totalAssets: null,
  totalSupply: null,
  maxWithdraw: null,
  maxRedeem: null,
  userAssetValue: null,
  rate: null,
};

const DEFAULT_META = {
  assetDecimals: 6,
  shareDecimals: 6,
  assetSymbol: "USDC",
  shareSymbol: "vwUSDC",
  profile: null,
  tokenOwner: null,
};

export default function Erc4626View({ account, networkName, isCorrectNetwork, refreshKey, refresh }) {
  const [meta, setMeta] = useState(DEFAULT_META);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [viewError, setViewError] = useState("");

  const { tx, pendingAction, execute } = useTransaction();

  const connected = Boolean(account);
  const ready = connected && isCorrectNetwork && isErc4626Configured;

  /* ---------------------------------------------------------------- *
   * READ — one batched snapshot of the whole vault
   * ---------------------------------------------------------------- */
  const readAll = useCallback(async () => {
    if (!ready) {
      setData(EMPTY_DATA);
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      const usdc = getUsdcRead(provider);
      const vault = getVaultRead(provider);

      // Token metadata first — every later number is denominated by it.
      const [assetDecimals, shareDecimals, assetSymbol, shareSymbol, profile, tokenOwner] =
        await Promise.all([
          usdc.decimals(),
          vault.decimals(),
          usdc.symbol(),
          vault.symbol(),
          vault.vaultProfile(),
          usdc.owner(),
        ]);

      const shareUnit = 10n ** BigInt(shareDecimals);

      const [
        usdcBalance,
        shareBalance,
        allowance,
        totalAssets,
        totalSupply,
        maxWithdraw,
        maxRedeem,
        rate,
      ] = await Promise.all([
        usdc.balanceOf(account),
        vault.balanceOf(account),
        usdc.allowance(account, VAULT_4626_ADDRESS),
        vault.totalAssets(),
        vault.totalSupply(),
        vault.maxWithdraw(account),
        vault.maxRedeem(account),
        // What one whole share is currently worth, for the headline rate.
        vault.convertToAssets(shareUnit),
      ]);

      // What this user's shares are worth right now.
      const userAssetValue = await vault.convertToAssets(shareBalance);

      setMeta({
        assetDecimals: Number(assetDecimals),
        shareDecimals: Number(shareDecimals),
        assetSymbol,
        shareSymbol,
        tokenOwner,
        profile: {
          label: profile.label,
          category: profile.category,
          riskNote: profile.riskNote,
          experiment: profile.experiment,
          assetAddress: profile.assetAddress,
          assetSymbol: profile.assetSymbol,
          shareSymbol: profile.shareSymbol,
          assetDecimals: Number(profile.assetDecimals),
          shareDecimals: Number(profile.shareDecimals),
        },
      });

      setData({
        usdcBalance,
        shareBalance,
        allowance,
        totalAssets,
        totalSupply,
        maxWithdraw,
        maxRedeem,
        userAssetValue,
        rate,
      });
      setViewError("");
    } catch (error) {
      setViewError(
        friendlyError(
          error,
          "Could not read the vault. Check that both Experiment 3 addresses are correct and that you are on Sepolia."
        )
      );
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [account, ready]);

  useEffect(() => {
    readAll();
  }, [readAll, refreshKey]);

  /* ---------------------------------------------------------------- *
   * READ — view calls used live by the preview and conversion panels
   * ---------------------------------------------------------------- */
  const vaultCall = useCallback(
    async (method, value) => {
      if (!ready) return null;
      return getVaultRead(getProvider())[method](value);
    },
    [ready]
  );

  const previewDeposit = useCallback((v) => vaultCall("previewDeposit", v), [vaultCall]);
  const previewMint = useCallback((v) => vaultCall("previewMint", v), [vaultCall]);
  const previewWithdraw = useCallback((v) => vaultCall("previewWithdraw", v), [vaultCall]);
  const previewRedeem = useCallback((v) => vaultCall("previewRedeem", v), [vaultCall]);
  const convertToShares = useCallback((v) => vaultCall("convertToShares", v), [vaultCall]);
  const convertToAssets = useCallback((v) => vaultCall("convertToAssets", v), [vaultCall]);

  /* ---------------------------------------------------------------- *
   * WRITE — approve, deposit, mint, withdraw, redeem, faucet
   * ---------------------------------------------------------------- */
  const guard = () => {
    if (!connected) return "Connect your wallet first.";
    if (!isErc4626Configured)
      return "Experiment 3 addresses are not configured. Set VITE_USDC_ADDRESS and VITE_VAULT4626_ADDRESS in frontend/.env.local.";
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    return "";
  };

  /** Wraps the shared transaction runner with this view's guard + refresh. */
  const send = useCallback(
    async (options) => {
      const problem = guard();
      if (problem) {
        setViewError(problem);
        return false;
      }
      setViewError("");

      const result = await execute({ ...options, logSources: logSources(getProvider()) });

      if (result.ok) refresh();
      else if (result.message) setViewError(result.message);
      return result.ok;
    },
    // `guard` reads state that is already in these deps.
    [execute, refresh, connected, isCorrectNetwork] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { assetDecimals, shareDecimals, assetSymbol, shareSymbol } = meta;

  const approve = (rawAmount) =>
    send({
      action: "approve",
      steps: ["Approve vault", "Move tokens"],
      activeStep: 0,
      finalStep: false,
      send: async () => {
        const usdc = await getUsdcWrite(getProvider());
        return usdc.approve(VAULT_4626_ADDRESS, rawAmount);
      },
      pending: `Approving the vault for ${formatAmount(rawAmount, assetDecimals)} ${assetSymbol}...`,
      success: `Vault approved for ${formatAmount(rawAmount, assetDecimals)} ${assetSymbol}. You can deposit now.`,
    });

  const deposit = (rawAssets) =>
    send({
      action: "deposit",
      steps: ["Approve vault", "Deposit"],
      activeStep: 1,
      send: async () => {
        const vault = await getVaultWrite(getProvider());
        return vault.deposit(rawAssets, account);
      },
      pending: `Depositing ${formatAmount(rawAssets, assetDecimals)} ${assetSymbol}...`,
      success: `Deposited ${formatAmount(rawAssets, assetDecimals)} ${assetSymbol} and received ${shareSymbol} shares.`,
    });

  const mintShares = (rawShares) =>
    send({
      action: "mint",
      steps: ["Approve vault", "Mint shares"],
      activeStep: 1,
      send: async () => {
        const vault = await getVaultWrite(getProvider());
        return vault.mint(rawShares, account);
      },
      pending: `Minting ${formatAmount(rawShares, shareDecimals)} ${shareSymbol}...`,
      success: `Minted ${formatAmount(rawShares, shareDecimals)} ${shareSymbol}.`,
    });

  const withdraw = (rawAssets) =>
    send({
      action: "withdraw",
      send: async () => {
        const vault = await getVaultWrite(getProvider());
        return vault.withdraw(rawAssets, account, account);
      },
      pending: `Withdrawing ${formatAmount(rawAssets, assetDecimals)} ${assetSymbol}...`,
      success: `Withdrew ${formatAmount(rawAssets, assetDecimals)} ${assetSymbol}.`,
    });

  const redeem = (rawShares) =>
    send({
      action: "redeem",
      send: async () => {
        const vault = await getVaultWrite(getProvider());
        return vault.redeem(rawShares, account, account);
      },
      pending: `Redeeming ${formatAmount(rawShares, shareDecimals)} ${shareSymbol}...`,
      success: `Redeemed ${formatAmount(rawShares, shareDecimals)} ${shareSymbol} for ${assetSymbol}.`,
    });

  const mintTestTokens = (amountText) => {
    const parsed = parseAmount(amountText, assetDecimals);
    if (!parsed.ok) {
      setViewError(parsed.error);
      return Promise.resolve(false);
    }

    return send({
      action: "faucet",
      send: async () => {
        const usdc = await getUsdcWrite(getProvider());
        return usdc.mint(account, parsed.value);
      },
      pending: `Minting ${amountText} ${assetSymbol} to your wallet...`,
      success: `Minted ${amountText} ${assetSymbol}.`,
    });
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  const isTokenOwner =
    Boolean(account) &&
    Boolean(meta.tokenOwner) &&
    account.toLowerCase() === meta.tokenOwner.toLowerCase();

  return (
    <>
      <section className="hero">
        <span className="hero-eyebrow">Experiment 3</span>
        <h1>ERC-4626 Tokenized Vault</h1>
        <p>
          Deposit {assetSymbol} and receive {shareSymbol} — real ERC-20 vault shares that
          represent your claim on everything the vault holds.
        </p>

        <div className="flow-diagram" aria-label="Architecture">
          <span className="flow-node">Your wallet</span>
          <span className="flow-edge">
            approve()
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">MockUSDC (ERC-20)</span>
          <span className="flow-edge">
            deposit()
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node accent">VaultWiseVault (ERC-4626)</span>
          <span className="flow-edge">
            issues
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">{shareSymbol} shares</span>
        </div>
      </section>

      {!isErc4626Configured && (
        <Banner tone="warn">
          <strong>Experiment 3 addresses not set.</strong> Deploy{" "}
          <code>MockUSDC</code> and <code>VaultWiseVault</code>, then set{" "}
          <code>VITE_USDC_ADDRESS</code> and <code>VITE_VAULT4626_ADDRESS</code> in{" "}
          <code>frontend/.env.local</code> and restart <code>npm run dev</code>.
        </Banner>
      )}

      {viewError && (
        <Banner tone="error" onDismiss={() => setViewError("")}>
          {viewError}
        </Banner>
      )}

      <VaultProfileCard profile={meta.profile} loading={loading && !meta.profile} />

      <Erc4626Stats data={data} meta={meta} loading={loading} />

      <div className="cards-grid cards-grid-wide">
        {connected ? (
          <AssetWalletCard
            account={account}
            networkName={networkName}
            usdcBalance={data.usdcBalance}
            allowance={data.allowance}
            meta={meta}
            isTokenOwner={isTokenOwner}
            onMintTestTokens={mintTestTokens}
            disabled={!ready}
            pending={pendingAction === "faucet"}
            loading={loading}
          />
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2>Wallet</h2>
            </div>
            <div className="empty">
              <p>Connect MetaMask to interact with the vault.</p>
            </div>
          </section>
        )}

        <ConversionPanel
          meta={meta}
          convertToShares={convertToShares}
          convertToAssets={convertToAssets}
        />
      </div>

      <div className="cards-grid">
        <DepositPanel
          meta={meta}
          usdcBalance={data.usdcBalance}
          allowance={data.allowance}
          onApprove={approve}
          onDeposit={deposit}
          onMintShares={mintShares}
          previewDeposit={previewDeposit}
          previewMint={previewMint}
          disabled={!ready}
          pendingAction={pendingAction}
        />
        <WithdrawPanel
          meta={meta}
          shareBalance={data.shareBalance}
          maxWithdraw={data.maxWithdraw}
          maxRedeem={data.maxRedeem}
          onWithdraw={withdraw}
          onRedeem={redeem}
          previewWithdraw={previewWithdraw}
          previewRedeem={previewRedeem}
          disabled={!ready}
          pendingAction={pendingAction}
        />
      </div>

      <TransactionStatus tx={tx} decimals={assetDecimals} />
    </>
  );
}
