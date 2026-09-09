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
 *
 * Deploy them with either:
 *     npx hardhat run scripts/deployExperiment3.js --network sepolia
 * or by hand in Remix — see the README.
 *
 * Restart `npm run dev` after editing an env file; Vite only reads them at
 * startup.
 * ────────────────────────────────────────────────────────────────────────
 */

import { ETH_VAULT_ABI, MOCK_USDC_ABI, VAULT_4626_ABI } from "./abis.generated";

/** Accepts a value only if it really looks like an address. */
const readAddress = (value) => (/^0x[a-fA-F0-9]{40}$/.test(value ?? "") ? value : "");

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

/** Target network for every VaultWise experiment: Sepolia (chain id 11155111). */
export const TARGET_CHAIN_ID = 11155111n;
export const TARGET_NETWORK_NAME = "Sepolia Testnet";

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
 * Experiment registry — drives the navbar switcher and the router
 * ------------------------------------------------------------------ */

export const EXPERIMENTS = [
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
export const DEFAULT_EXPERIMENT = "experiment-3";

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
