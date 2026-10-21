import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, JsonRpcProvider, Network, ZeroAddress } from "ethers";

import {
  AMM_ADDRESS,
  DEX_FACTORY_ABI,
  DEX_FACTORY_ADDRESS,
  DEX_PAIR_ABI,
  DEX_ROUTER_ADDRESS,
  DEX_TOKEN_ABI,
  DEX_TOKEN_ADDRESSES,
  ETH_VAULT_ABI,
  ETH_VAULT_ADDRESS,
  MOCK_ERC20_ABI,
  PUBLIC_RPC_URL,
  SIMPLE_AMM_ABI,
  STAKING_ADDRESS,
  TARGET_CHAIN_ID,
  VAULT_4626_ABI,
  VAULT_4626_ADDRESS,
  YIELD_FARM_ADDRESS,
  isAmmConfigured,
  isDexConfigured,
  isErc4626Configured,
  isEthVaultConfigured,
} from "../contracts/contractConfig";
import { POOLS } from "../experiments/experiment5/pools";
import { PAIR_KEYS } from "../experiments/experiment6/dex";
import { TOKENS } from "../platform/registry";
import { getProvider } from "./useWallet";

/**
 * One read of the whole protocol: every token balance, every pool, every
 * position, in a single snapshot pinned to one block.
 *
 * Reads go through the wallet when it is connected to Sepolia (so a confirmed
 * transaction is reflected immediately) and through a public RPC otherwise —
 * so the markets render for a visitor who has not connected anything.
 *
 * Every call is wrapped so a single misconfigured contract shows as missing
 * instead of blanking the whole platform.
 */

const POLL_MS = 20_000;

let publicProvider = null;
const getPublicProvider = () => {
  if (!publicProvider) {
    const network = Network.from(Number(TARGET_CHAIN_ID));
    publicProvider = new JsonRpcProvider(PUBLIC_RPC_URL, network, { staticNetwork: network });
  }
  return publicProvider;
};

/** Resolve to null instead of throwing. */
const safe = (promise) => promise.then((value) => value, () => null);

/** Every token is read with this ABI — it has `owner()`, which DexMockERC20 simply lacks. */
const TOKEN_READ_ABI = MOCK_ERC20_ABI;

export async function readSnapshot(provider, account) {
  const block = await provider.getBlock("latest");
  const at = { blockTag: block.number };
  const me = account ?? ZeroAddress;

  /* ── tokens ─────────────────────────────────────────────────────── */
  const tokenEntries = await Promise.all(
    TOKENS.map(async (token) => {
      const c = new Contract(token.address, TOKEN_READ_ABI, provider);
      const [decimals, totalSupply, balance, owner] = await Promise.all([
        safe(c.decimals(at)),
        safe(c.totalSupply(at)),
        account ? safe(c.balanceOf(account, at)) : null,
        token.faucet === "owner" ? safe(c.owner(at)) : null,
      ]);
      return [token.id, { ...token, decimals: decimals === null ? 18 : Number(decimals), totalSupply, balance, owner }];
    })
  );
  const tokens = Object.fromEntries(tokenEntries);

  const ethBalance = account ? await safe(provider.getBalance(account, at.blockTag)) : null;

  /* ── Experiment 1: ETH vault ────────────────────────────────────── */
  let ethVault = { configured: isEthVaultConfigured };
  if (isEthVaultConfigured) {
    const c = new Contract(ETH_VAULT_ADDRESS, ETH_VAULT_ABI, provider);
    const [total, mine] = await Promise.all([
      safe(c.totalDeposits(at)),
      account ? safe(c.deposits(account, at)) : null,
    ]);
    ethVault = { ...ethVault, total, mine };
  }

  /* ── Experiment 3: ERC-4626 vault ───────────────────────────────── */
  let vault4626 = { configured: isErc4626Configured };
  if (isErc4626Configured) {
    const c = new Contract(VAULT_4626_ADDRESS, VAULT_4626_ABI, provider);
    const usdc = new Contract(tokens.USDC.address, TOKEN_READ_ABI, provider);
    const [totalAssets, totalSupply, shares, maxWithdraw, allowance] = await Promise.all([
      safe(c.totalAssets(at)),
      safe(c.totalSupply(at)),
      account ? safe(c.balanceOf(account, at)) : null,
      account ? safe(c.maxWithdraw(account, at)) : null,
      account ? safe(usdc.allowance(account, VAULT_4626_ADDRESS, at)) : null,
    ]);
    const shareValue = shares ? await safe(c.convertToAssets(shares, at)) : shares;
    vault4626 = { ...vault4626, totalAssets, totalSupply, shares, shareValue, maxWithdraw, allowance };
  }

  /* ── Experiment 4: classic no-fee AMM ───────────────────────────── */
  let amm = { configured: isAmmConfigured };
  if (isAmmConfigured) {
    const c = new Contract(AMM_ADDRESS, SIMPLE_AMM_ABI, provider);
    const tka = new Contract(tokens.TKA.address, TOKEN_READ_ABI, provider);
    const tkb = new Contract(tokens.TKB.address, TOKEN_READ_ABI, provider);
    const [reserveA, reserveB, supply, lp, allowanceA, allowanceB] = await Promise.all([
      safe(c.reserveA(at)),
      safe(c.reserveB(at)),
      safe(c.totalSupply(at)),
      account ? safe(c.balanceOf(account, at)) : null,
      account ? safe(tka.allowance(account, AMM_ADDRESS, at)) : null,
      account ? safe(tkb.allowance(account, AMM_ADDRESS, at)) : null,
    ]);
    amm = { ...amm, reserveA, reserveB, supply, lp, allowanceA, allowanceB };
  }

  /* ── Experiment 5: farm + staking ───────────────────────────────── */
  const readRewardPool = async (pool, poolAddress) => {
    if (!pool.configured) return { configured: false };
    const c = new Contract(poolAddress, pool.abi, provider);
    const stakeToken = new Contract(pool.address.stake, TOKEN_READ_ABI, provider);
    const [totalStaked, rewardBalance, rate, precision, staked, earned, allowance] = await Promise.all([
      safe(c.totalStaked(at)),
      safe(c.rewardBalance(at)),
      safe(c.rewardRate(at)),
      safe(c.REWARD_PRECISION(at)),
      account ? safe(c.stakedBalance(account, at)) : null,
      account ? safe(c.earned(account, at)) : null,
      account ? safe(stakeToken.allowance(account, poolAddress, at)) : null,
    ]);
    return { configured: true, totalStaked, rewardBalance, rate, precision, staked, earned, allowance };
  };
  const [farm, staking] = await Promise.all([
    readRewardPool(POOLS.farm, YIELD_FARM_ADDRESS),
    readRewardPool(POOLS.staking, STAKING_ADDRESS),
  ]);

  /* ── Experiment 6: DEX ──────────────────────────────────────────── */
  let dex = { configured: isDexConfigured, pairs: {}, allowances: {} };
  if (isDexConfigured) {
    const factory = new Contract(DEX_FACTORY_ADDRESS, DEX_FACTORY_ABI, provider);
    const allowanceEntries = await Promise.all(
      Object.entries(DEX_TOKEN_ADDRESSES).map(async ([key, address]) => [
        key,
        account ? await safe(new Contract(address, DEX_TOKEN_ABI, provider).allowance(account, DEX_ROUTER_ADDRESS, at)) : null,
      ])
    );
    const pairEntries = await Promise.all(
      PAIR_KEYS.map(async ({ key, x, y }) => {
        const address = await safe(factory.getPair(DEX_TOKEN_ADDRESSES[x], DEX_TOKEN_ADDRESSES[y], at));
        if (!address || address === ZeroAddress) return [key, { key, x, y, address: null }];
        const pair = new Contract(address, DEX_PAIR_ABI, provider);
        const [token0, reserves, supply, lp, lpAllowance] = await Promise.all([
          safe(pair.token0(at)),
          safe(pair.getReserves(at)),
          safe(pair.totalSupply(at)),
          account ? safe(pair.balanceOf(account, at)) : null,
          account ? safe(pair.allowance(account, DEX_ROUTER_ADDRESS, at)) : null,
        ]);
        // Store reserves in (x, y) order so callers never think about token0.
        const xIsToken0 = token0?.toLowerCase() === DEX_TOKEN_ADDRESSES[x].toLowerCase();
        const r0 = reserves?.[0] ?? 0n;
        const r1 = reserves?.[1] ?? 0n;
        return [
          key,
          { key, x, y, address, reserveX: xIsToken0 ? r0 : r1, reserveY: xIsToken0 ? r1 : r0, supply, lp, lpAllowance },
        ];
      })
    );
    dex = { ...dex, pairs: Object.fromEntries(pairEntries), allowances: Object.fromEntries(allowanceEntries) };
  }

  return {
    account: account ?? null,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    readAt: Date.now(),
    me,
    tokens,
    ethBalance,
    ethVault,
    vault4626,
    amm,
    farm,
    staking,
    dex,
  };
}

/**
 * @param {{ account: string|null, isCorrectNetwork: boolean, refreshKey: number }} wallet
 */
export function useProtocolData({ account, isCorrectNetwork, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const useWalletProvider = Boolean(account) && isCorrectNetwork;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const provider = useWalletProvider ? getProvider() : getPublicProvider();
      // Positions are only shown for a connected account; on the wrong
      // network the account is still known, so read its Sepolia positions.
      const snapshot = await readSnapshot(provider, account);
      if (id !== requestId.current) return; // a newer read superseded this one
      setData(snapshot);
      setError("");
    } catch (err) {
      if (id !== requestId.current) return;
      console.error("[VaultWise] protocol read failed", err);
      setError("Could not reach Sepolia. Retrying automatically.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [account, useWalletProvider]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Poll while the tab is visible — balances and rewards move between blocks.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Never show one account's positions under another account.
  const current = useMemo(
    () => (data && (data.account ?? null) === (account ?? null) ? data : null),
    [data, account]
  );

  return { data: current, staleData: data, loading, error, reload: load };
}
