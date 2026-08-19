/**
 * VaultWise — contract configuration
 * ==================================
 *
 * This is the ONLY file in the frontend that knows the deployed contract
 * address and its ABI. Components never hardcode either one.
 *
 * ────────────────────────────────────────────────────────────────────────
 * AFTER YOU DEPLOY `contracts/VaultWiseVault.sol` IN REMIX:
 *
 *   1. In Remix, open the "Deployed Contracts" panel (bottom left).
 *   2. Click the copy icon next to `VAULTWISEVAULT AT 0x...`.
 *   3. Paste that address below as CONTRACT_ADDRESS — OR, better, put it in
 *      `frontend/.env.local` as:
 *
 *          VITE_CONTRACT_ADDRESS=0xYourDeployedAddressHere
 *
 *      (the env value wins if it is set, so you don't have to edit code).
 *
 *   The ABI below was written by hand to exactly match VaultWiseVault.sol,
 *   so you normally do NOT need to touch it. If you ever change the .sol
 *   file, regenerate it in Remix:
 *      Solidity Compiler tab → compile → "ABI" copy button at the bottom
 *      → paste the copied JSON array as the value of CONTRACT_ABI below.
 * ────────────────────────────────────────────────────────────────────────
 */

/** Deployed VaultWiseVault address. Replace after deploying via Remix. */
export const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || "PASTE_YOUR_DEPLOYED_ADDRESS_HERE";

/** ABI of VaultWiseVault.sol (human-readable-free, standard JSON ABI). */
export const CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Withdrawn",
    type: "event",
  },
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "deposits",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalDeposits",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMyDeposit",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getVaultBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
  { stateMutability: "payable", type: "fallback" },
];

/** Target network for this experiment: Sepolia testnet (chain id 11155111). */
export const TARGET_CHAIN_ID = 11155111n;
export const TARGET_NETWORK_NAME = "Sepolia Testnet";

/** Block explorer used for transaction links. */
export const EXPLORER_TX_BASE_URL = "https://sepolia.etherscan.io/tx/";

/** True once a real address has been pasted in (or provided via .env.local). */
export const isContractConfigured =
  /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
