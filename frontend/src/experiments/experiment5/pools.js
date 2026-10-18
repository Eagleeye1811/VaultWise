import { Contract } from "ethers";

import {
  ABC_ADDRESS,
  FARM_RWD_ADDRESS,
  LPT_ADDRESS,
  MOCK_ERC20_ABI,
  SIMPLE_STAKING_ABI,
  SIMPLE_YIELD_FARM_ABI,
  STAKING_ADDRESS,
  STAKING_RWD_ADDRESS,
  YIELD_FARM_ADDRESS,
  isStakingConfigured,
  isYieldFarmConfigured,
} from "../../contracts/contractConfig";

/**
 * The two Experiment 5 simulations, described as data.
 *
 * SimpleYieldFarm and SimpleStaking share one reward model but deliberately
 * keep the experiment sheet's own vocabulary — harvest()/withdraw() and
 * RewardPaid/Withdrawn for farming, claimReward()/unstake() and
 * RewardClaimed/Unstaked for staking. Each descriptor maps the shared UI onto
 * one contract's names, so the two flows stay distinct on-chain and on screen
 * without duplicating the dashboard.
 */
export const POOLS = {
  farm: {
    key: "farm",
    part: 1,
    title: "Yield Farming",
    contractName: "SimpleYieldFarm",
    noun: "farm",
    abi: SIMPLE_YIELD_FARM_ABI,
    configured: isYieldFarmConfigured,
    address: { stake: LPT_ADDRESS, reward: FARM_RWD_ADDRESS, pool: YIELD_FARM_ADDRESS },
    env: { stake: "VITE_LPT_ADDRESS", reward: "VITE_FARM_RWD_ADDRESS", pool: "VITE_YIELD_FARM_ADDRESS" },
    fallbackSymbol: { stake: "LPT", reward: "RWD" },
    stakeTokenName: "LP Token",
    fn: { claim: "harvest", withdraw: "withdraw" },
    event: { stake: "Staked", reward: "RewardPaid", withdraw: "Withdrawn" },
    noReward: "NoRewardToHarvest",
    verb: { claim: "Harvest", claiming: "Harvesting", withdraw: "Withdraw", withdrawing: "Withdrawing" },
    blurb:
      "Stake an LP-like token — the position you get after providing AMM liquidity — and farm RWD as an extra incentive on top of it.",
    flow: ["Provide liquidity", "LPT", "Farm", "RWD"],
  },
  staking: {
    key: "staking",
    part: 2,
    title: "Protocol Staking",
    contractName: "SimpleStaking",
    noun: "staking contract",
    abi: SIMPLE_STAKING_ABI,
    configured: isStakingConfigured,
    address: { stake: ABC_ADDRESS, reward: STAKING_RWD_ADDRESS, pool: STAKING_ADDRESS },
    env: { stake: "VITE_ABC_ADDRESS", reward: "VITE_STAKING_RWD_ADDRESS", pool: "VITE_STAKING_ADDRESS" },
    fallbackSymbol: { stake: "ABC", reward: "RWD" },
    stakeTokenName: "Protocol Token",
    fn: { claim: "claimReward", withdraw: "unstake" },
    event: { stake: "Staked", reward: "RewardClaimed", withdraw: "Unstaked" },
    noReward: "NoRewardToClaim",
    verb: { claim: "Claim reward", claiming: "Claiming", withdraw: "Unstake", withdrawing: "Unstaking" },
    blurb:
      "Stake the ABC protocol token directly — no liquidity pool, so no impermanent loss — and earn RWD under the protocol's reward rule.",
    flow: ["ABC", "Stake", "Reward", "Unstake"],
  },
};

export const POOL_KEYS = ["farm", "staking"];

/* ------------------------------------------------------------------ *
 * Contract instances — the same READ / WRITE split as Experiments 3–4:
 *   READ   provider-connected — view calls, no gas, no MetaMask popup
 *   WRITE  signer-connected   — state changes, costs gas, needs a signature
 * ------------------------------------------------------------------ */

/** The staking or reward token ("stake" | "reward") — read-only. */
export const getTokenRead = (pool, role, provider) =>
  new Contract(pool.address[role], MOCK_ERC20_ABI, provider);

/** The staking or reward token — signer-connected, for approve() and owner-only mint(). */
export const getTokenWrite = async (pool, role, provider) =>
  new Contract(pool.address[role], MOCK_ERC20_ABI, await provider.getSigner());

/** SimpleYieldFarm / SimpleStaking — read-only. */
export const getPoolRead = (pool, provider) => new Contract(pool.address.pool, pool.abi, provider);

/** SimpleYieldFarm / SimpleStaking — signer-connected. */
export const getPoolWrite = async (pool, provider) =>
  new Contract(pool.address.pool, pool.abi, await provider.getSigner());

/**
 * Log sources for decoding a receipt. All three contracts emit on distinct
 * addresses; the two tokens share the ERC-20 `Transfer` signature, so logs
 * are matched on emitting address (see useTransaction).
 */
export const logSources = (pool, provider, symbols) => [
  { name: symbols.stake, address: pool.address.stake, iface: getTokenRead(pool, "stake", provider).interface },
  { name: symbols.reward, address: pool.address.reward, iface: getTokenRead(pool, "reward", provider).interface },
  {
    name: pool.contractName,
    address: pool.address.pool,
    iface: getPoolRead(pool, provider).interface,
    standardOf: () => (pool.key === "farm" ? "Farm" : "Staking"),
  },
];
