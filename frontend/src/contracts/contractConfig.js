/**
 * VaultWise — contract configuration
 * ==================================
 *
 * The single place the frontend learns *what is deployed where*. No component
 * hardcodes an address or an ABI; they all import from here.
 *
 * ABIs are NOT written by hand. They are generated from the Hardhat
 * compilation artifacts into `abis.generated.js`:
 *
 *     npx hardhat compile      (from the repository root)
 *     npm run sync-abi
 *
 * so the ABI the browser uses always matches the bytecode that was compiled
 * from `contracts/`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ADDRESSES
 *
 * Set these in `frontend/.env.local` (git-ignored) after deploying:
 *
 *     VITE_CONTRACT_ADDRESS=0x...   Experiment 1 — the plain ETH vault
 *     VITE_USDC_ADDRESS=0x...       Experiment 3 — MockUSDC (ERC-20 asset)
 *     VITE_VAULT4626_ADDRESS=0x...  Experiment 3 — VaultWiseVault (ERC-4626)
 *     VITE_TOKEN_A_ADDRESS=0x...    Experiment 4 — MockERC20 "Token A" (TKA)
 *     VITE_TOKEN_B_ADDRESS=0x...    Experiment 4 — MockERC20 "Token B" (TKB)
 *     VITE_AMM_ADDRESS=0x...        Experiment 4 — SimpleAMM(TKA, TKB)
 *     VITE_LPT_ADDRESS=0x...        Experiment 5 — MockERC20 "LP Token" (LPT)
 *     VITE_FARM_RWD_ADDRESS=0x...   Experiment 5 — MockERC20 "Reward Token" (RWD) for the farm
 *     VITE_YIELD_FARM_ADDRESS=0x... Experiment 5 — SimpleYieldFarm(LPT, RWD)
 *     VITE_ABC_ADDRESS=0x...        Experiment 5 — MockERC20 "Protocol Token" (ABC)
 *     VITE_STAKING_RWD_ADDRESS=0x...Experiment 5 — MockERC20 "Reward Token" (RWD) for staking
 *     VITE_STAKING_ADDRESS=0x...    Experiment 5 — SimpleStaking(ABC, RWD)
 *     VITE_DEX_FACTORY_ADDRESS=0x...Experiment 6 — DEX Factory
 *     VITE_DEX_ROUTER_ADDRESS=0x... Experiment 6 — DEX Router(Factory)
 *     VITE_DEX_TOKEN_A_ADDRESS=0x...Experiment 6 — DexMockERC20 "Token A" (DXA)
 *     VITE_DEX_TOKEN_B_ADDRESS=0x...Experiment 6 — DexMockERC20 "Token B" (DXB)
 *     VITE_DEX_TOKEN_C_ADDRESS=0x...Experiment 6 — DexMockERC20 "Token C" (DXC)
 *     VITE_ORACLE_ADDRESS=0x...     PriceOracle — Chainlink-backed USD prices
 *
 * Deploy them with either:
 *     npx hardhat run scripts/deployExperiment3.js --network sepolia
 *     npx hardhat run scripts/deployExperiment4.js --network sepolia
 *     npx hardhat run scripts/deployExperiment5.js --network sepolia
 *     npx hardhat run scripts/deployExperiment6.js --network sepolia
 *     npx hardhat run scripts/deployOracle.js --network sepolia
 * or by hand in Remix — see the README.
 *
 * Restart `npm run dev` after editing an env file; Vite only reads them at
 * startup.
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  DEX_FACTORY_ABI,
  DEX_PAIR_ABI,
  DEX_ROUTER_ABI,
  DEX_TOKEN_ABI,
  ETH_VAULT_ABI,
  MOCK_ERC20_ABI,
  MOCK_USDC_ABI,
  PRICE_ORACLE_ABI,
  SIMPLE_AMM_ABI,
  SIMPLE_STAKING_ABI,
  SIMPLE_YIELD_FARM_ABI,
  VAULT_4626_ABI,
} from "./abis.generated";

/** Accepts a value only if it really looks like an address. */
const readAddress = (value) => (/^0x[a-fA-F0-9]{40}$/.test(value ?? "") ? value : "");

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

/** Target network for every VaultWise experiment: Sepolia (chain id 11155111). */
export const TARGET_CHAIN_ID = 11155111n;
export const TARGET_NETWORK_NAME = "Sepolia Testnet";

/**
 * Public Sepolia RPC used for READS when no wallet is connected (or the wallet
 * is on another network), so markets and TVL render for every visitor.
 * Writes always go through MetaMask. Override with VITE_SEPOLIA_RPC_URL.
 */
export const PUBLIC_RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

/** Block explorer links. */
export const EXPLORER_TX_BASE_URL = "https://sepolia.etherscan.io/tx/";
export const EXPLORER_ADDRESS_BASE_URL = "https://sepolia.etherscan.io/address/";

/* ------------------------------------------------------------------ *
 * Experiment 1 — plain ETH vault
 * ------------------------------------------------------------------ */

export const ETH_VAULT_ADDRESS = readAddress(import.meta.env.VITE_CONTRACT_ADDRESS);
export { ETH_VAULT_ABI };

export const isEthVaultConfigured = ETH_VAULT_ADDRESS !== "";

/* ------------------------------------------------------------------ *
 * Experiment 3 — ERC-20 asset + ERC-4626 tokenized vault
 * ------------------------------------------------------------------ */

/** MockUSDC, the ERC-20 token the vault is denominated in. */
export const USDC_ADDRESS = readAddress(import.meta.env.VITE_USDC_ADDRESS);

/** VaultWiseVault, the ERC-4626 vault that issues vwUSDC shares. */
export const VAULT_4626_ADDRESS = readAddress(import.meta.env.VITE_VAULT4626_ADDRESS);

export { MOCK_USDC_ABI, VAULT_4626_ABI };

/** Experiment 3 needs BOTH contracts — a vault with no asset is unusable. */
export const isErc4626Configured = USDC_ADDRESS !== "" && VAULT_4626_ADDRESS !== "";

/* ------------------------------------------------------------------ *
 * Experiment 4 — AMM liquidity pool
 *
 * Two deployments of the same MockERC20 source, plus the pool. These are new
 * contracts: they are never inferred from the Experiment 3 addresses.
 * ------------------------------------------------------------------ */

/** MockERC20("Token A", "TKA"). */
export const TOKEN_A_ADDRESS = readAddress(import.meta.env.VITE_TOKEN_A_ADDRESS);

/** MockERC20("Token B", "TKB"). */
export const TOKEN_B_ADDRESS = readAddress(import.meta.env.VITE_TOKEN_B_ADDRESS);

/** SimpleAMM(TKA, TKB), whose own ERC-20 is the vwLP share. */
export const AMM_ADDRESS = readAddress(import.meta.env.VITE_AMM_ADDRESS);

/**
 * Optional: block SimpleAMM was deployed in. The pool-activity history reads
 * event logs from here; when unset it falls back to a recent window. Purely a
 * performance hint — it never changes a balance or reserve shown.
 */
export const AMM_DEPLOY_BLOCK = /^\d+$/.test(import.meta.env.VITE_AMM_DEPLOY_BLOCK ?? "")
  ? Number(import.meta.env.VITE_AMM_DEPLOY_BLOCK)
  : null;

export { MOCK_ERC20_ABI, SIMPLE_AMM_ABI };

/** The pool is unusable unless all three addresses are set. */
export const isAmmConfigured =
  TOKEN_A_ADDRESS !== "" && TOKEN_B_ADDRESS !== "" && AMM_ADDRESS !== "";

/* ------------------------------------------------------------------ *
 * Experiment 5 — yield farming (Part 1) and protocol staking (Part 2)
 *
 * Two independent sets, as the experiment sheet deploys them: each part has
 * its own MockERC20 staking token, its own MockERC20 "RWD" reward token and
 * its own reward contract. They share no addresses with Experiment 4.
 * ------------------------------------------------------------------ */

/** Part 1 — MockERC20("LP Token", "LPT"), the LP-like token being farmed. */
export const LPT_ADDRESS = readAddress(import.meta.env.VITE_LPT_ADDRESS);

/** Part 1 — MockERC20("Reward Token", "RWD") paid by the farm. */
export const FARM_RWD_ADDRESS = readAddress(import.meta.env.VITE_FARM_RWD_ADDRESS);

/** Part 1 — SimpleYieldFarm(LPT, RWD). */
export const YIELD_FARM_ADDRESS = readAddress(import.meta.env.VITE_YIELD_FARM_ADDRESS);

/** Part 2 — MockERC20("Protocol Token", "ABC"), the protocol token being staked. */
export const ABC_ADDRESS = readAddress(import.meta.env.VITE_ABC_ADDRESS);

/** Part 2 — MockERC20("Reward Token", "RWD") paid by the staking contract. */
export const STAKING_RWD_ADDRESS = readAddress(import.meta.env.VITE_STAKING_RWD_ADDRESS);

/** Part 2 — SimpleStaking(ABC, RWD). */
export const STAKING_ADDRESS = readAddress(import.meta.env.VITE_STAKING_ADDRESS);

export { SIMPLE_STAKING_ABI, SIMPLE_YIELD_FARM_ABI };

/** Each part is usable on its own once its three addresses are set. */
export const isYieldFarmConfigured =
  LPT_ADDRESS !== "" && FARM_RWD_ADDRESS !== "" && YIELD_FARM_ADDRESS !== "";
export const isStakingConfigured =
  ABC_ADDRESS !== "" && STAKING_RWD_ADDRESS !== "" && STAKING_ADDRESS !== "";

/* ------------------------------------------------------------------ *
 * Experiment 6 — DEX prototype (Factory + Pair + Router)
 *
 * Pairs are not configured: they are created on-chain by the Factory and
 * looked up with getPair(), so only the Factory, the Router and the three
 * demo tokens need addresses. None are shared with Experiments 4–5.
 * ------------------------------------------------------------------ */

/** Factory — creates and indexes the pairs. */
export const DEX_FACTORY_ADDRESS = readAddress(import.meta.env.VITE_DEX_FACTORY_ADDRESS);

/** Router(Factory) — the only contract users send transactions to (plus approvals). */
export const DEX_ROUTER_ADDRESS = readAddress(import.meta.env.VITE_DEX_ROUTER_ADDRESS);

/** DexMockERC20 "Token A" (DXA), "Token B" (DXB), "Token C" (DXC) — public mint. */
export const DEX_TOKEN_ADDRESSES = {
  A: readAddress(import.meta.env.VITE_DEX_TOKEN_A_ADDRESS),
  B: readAddress(import.meta.env.VITE_DEX_TOKEN_B_ADDRESS),
  C: readAddress(import.meta.env.VITE_DEX_TOKEN_C_ADDRESS),
};

export { DEX_FACTORY_ABI, DEX_PAIR_ABI, DEX_ROUTER_ABI, DEX_TOKEN_ABI };

/** The DEX needs the Factory, the Router and all three demo tokens. */
export const isDexConfigured =
  DEX_FACTORY_ADDRESS !== "" &&
  DEX_ROUTER_ADDRESS !== "" &&
  Object.values(DEX_TOKEN_ADDRESSES).every((address) => address !== "");

/* ------------------------------------------------------------------ *
 * Price oracle
 *
 * PriceOracle maps each platform token to a Chainlink feed and returns
 * validated 18-decimal USD prices. Without it the app still works; values
 * are simply shown in tokens only.
 * ------------------------------------------------------------------ */

/** PriceOracle — the single source of USD prices. */
export const ORACLE_ADDRESS = readAddress(import.meta.env.VITE_ORACLE_ADDRESS);

/** The sentinel address under which PriceOracle prices native ETH (PriceOracle.ETH). */
export const ORACLE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export { PRICE_ORACLE_ABI };

export const isOracleConfigured = ORACLE_ADDRESS !== "";

/* ------------------------------------------------------------------ *
 * Experiment registry — drives the navbar switcher and the router
 * ------------------------------------------------------------------ */

export const EXPERIMENTS = [
  {
    id: "experiment-6",
    number: 6,
    slug: "experiment-6",
    title: "DEX Prototype",
    short: "DEX",
    blurb: "Factory + Pair + Router: create pools, provide liquidity, and swap with a 0.3% fee, including multi-hop.",
    configured: isDexConfigured,
  },
  {
    id: "experiment-5",
    number: 5,
    slug: "experiment-5",
    title: "Yield Farming & Staking",
    short: "Farm & Stake",
    blurb: "Farm RWD by staking LPT, or stake the ABC protocol token for RWD.",
    configured: isYieldFarmConfigured || isStakingConfigured,
  },
  {
    id: "experiment-4",
    number: 4,
    slug: "experiment-4",
    title: "AMM Liquidity Pool",
    short: "AMM Pool",
    blurb: "Provide TKA/TKB liquidity for vwLP shares and swap on a constant-product pool.",
    configured: isAmmConfigured,
  },
  {
    id: "experiment-3",
    number: 3,
    slug: "experiment-3",
    title: "ERC-4626 Tokenized Vault",
    short: "ERC-4626 Vault",
    blurb: "Deposit MockUSDC, receive transferable vwUSDC vault shares.",
    configured: isErc4626Configured,
  },
  {
    id: "experiment-1",
    number: 1,
    slug: "experiment-1",
    title: "React + Ethers.js ETH Vault",
    short: "ETH Vault",
    blurb: "The original plain-ETH vault that started VaultWise.",
    configured: isEthVaultConfigured,
  },
];

/** The experiment shown when the URL has no (or an unknown) hash. */
export const DEFAULT_EXPERIMENT = "experiment-6";

/* ------------------------------------------------------------------ *
 * Backwards compatibility
 *
 * Experiment 1 shipped with `CONTRACT_ADDRESS` / `CONTRACT_ABI` /
 * `isContractConfigured`. They are kept as aliases so nothing that still
 * imports the old names breaks.
 * ------------------------------------------------------------------ */

export const CONTRACT_ADDRESS = ETH_VAULT_ADDRESS;
export const CONTRACT_ABI = ETH_VAULT_ABI;
export const isContractConfigured = isEthVaultConfigured;
