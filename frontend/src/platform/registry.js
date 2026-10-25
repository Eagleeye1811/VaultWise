import {
  ABC_ADDRESS,
  AMM_ADDRESS,
  DEX_TOKEN_ADDRESSES,
  FARM_RWD_ADDRESS,
  LPT_ADDRESS,
  STAKING_RWD_ADDRESS,
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
  USDC_ADDRESS,
  VAULT_4626_ADDRESS,
  isAmmConfigured,
  isDexConfigured,
  isErc4626Configured,
  isEthVaultConfigured,
  isStakingConfigured,
  isYieldFarmConfigured,
} from "../contracts/contractConfig";

/**
 * The platform's view of everything deployed: which tokens exist, which
 * products exist, and where each one lives in the app.
 *
 * Addresses still come only from `contractConfig.js`; this file adds the
 * product-level description (names, faucet rules, colours) the experiment
 * views never needed because each one showed a single contract.
 */

/**
 * Every ERC-20 the platform knows about.
 *
 * `faucet` says who may mint: "public" (DexMockERC20 — anyone), "owner"
 * (Ownable mocks — only the deploying wallet), or null (not mintable, e.g.
 * vault or LP shares that only exist as receipts).
 */
export const TOKENS = [
  { id: "USDC", symbol: "USDC", name: "Mock USD Coin", address: USDC_ADDRESS, faucet: "owner", hue: "#2f5d8a", product: "Vaults" },
  { id: "vwUSDC", symbol: "vwUSDC", name: "VaultWise USDC vault share", address: VAULT_4626_ADDRESS, faucet: null, hue: "#46698f", product: "Vaults" },
  { id: "DXA", symbol: "DXA", name: "DEX Token A", address: DEX_TOKEN_ADDRESSES.A, faucet: "public", hue: "#5b4f86", product: "DEX" },
  { id: "DXB", symbol: "DXB", name: "DEX Token B", address: DEX_TOKEN_ADDRESSES.B, faucet: "public", hue: "#8a4f68", product: "DEX" },
  { id: "DXC", symbol: "DXC", name: "DEX Token C", address: DEX_TOKEN_ADDRESSES.C, faucet: "public", hue: "#94692f", product: "DEX" },
  { id: "TKA", symbol: "TKA", name: "Token A", address: TOKEN_A_ADDRESS, faucet: "owner", hue: "#2f7575", product: "Classic pool" },
  { id: "TKB", symbol: "TKB", name: "Token B", address: TOKEN_B_ADDRESS, faucet: "owner", hue: "#3f7552", product: "Classic pool" },
  { id: "vwLP", symbol: "vwLP", name: "Classic pool LP share", address: AMM_ADDRESS, faucet: null, hue: "#5d636b", product: "Classic pool" },
  { id: "LPT", symbol: "LPT", name: "Farm LP Token", address: LPT_ADDRESS, faucet: "owner", hue: "#4f6d3c", product: "Farm" },
  { id: "RWD_F", symbol: "RWD", name: "Farm reward token", address: FARM_RWD_ADDRESS, faucet: "owner", hue: "#857331", product: "Farm" },
  { id: "ABC", symbol: "ABC", name: "Protocol Token", address: ABC_ADDRESS, faucet: "owner", hue: "#965a33", product: "Staking" },
  { id: "RWD_S", symbol: "RWD", name: "Staking reward token", address: STAKING_RWD_ADDRESS, faucet: "owner", hue: "#7d6c34", product: "Staking" },
].filter((token) => token.address !== "");

export const TOKEN_BY_ID = Object.fromEntries(TOKENS.map((token) => [token.id, token]));

/** DEX token key ("A" | "B" | "C") -> registry id. */
export const DEX_TOKEN_ID = { A: "DXA", B: "DXB", C: "DXC" };

/** The products, in the order the overview lists them. */
export const PRODUCTS = [
  { id: "dex", name: "VaultWise DEX", kind: "Exchange", route: "swap", configured: isDexConfigured, experiment: 6 },
  { id: "amm", name: "Classic TKA/TKB pool", kind: "Liquidity", route: "pools", configured: isAmmConfigured, experiment: 4 },
  { id: "vault4626", name: "Core USDC Vault", kind: "Vault", route: "earn", configured: isErc4626Configured, experiment: 3 },
  { id: "ethVault", name: "ETH Savings Vault", kind: "Vault", route: "earn", configured: isEthVaultConfigured, experiment: 1 },
  { id: "farm", name: "LPT Yield Farm", kind: "Farm", route: "earn", configured: isYieldFarmConfigured, experiment: 5 },
  { id: "staking", name: "ABC Staking", kind: "Staking", route: "earn", configured: isStakingConfigured, experiment: 5 },
];

/** Sidebar navigation. `labs` hosts the original experiment views. */
export const NAV = [
  { route: "overview", label: "Overview", icon: "grid" },
  { route: "swap", label: "Swap", icon: "swap" },
  { route: "pools", label: "Pools", icon: "drop" },
  { route: "earn", label: "Earn", icon: "spark" },
  { route: "portfolio", label: "Portfolio", icon: "wallet" },
  { route: "prices", label: "Prices", icon: "pulse" },
  { route: "faucet", label: "Faucet", icon: "faucet" },
  { route: "activity", label: "Activity", icon: "clock" },
  { route: "labs", label: "Labs", icon: "flask" },
];

export const DEFAULT_ROUTE = "overview";
