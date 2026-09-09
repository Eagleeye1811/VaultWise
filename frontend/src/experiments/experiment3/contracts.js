import { Contract } from "ethers";

import {
  MOCK_USDC_ABI,
  USDC_ADDRESS,
  VAULT_4626_ABI,
  VAULT_4626_ADDRESS,
} from "../../contracts/contractConfig";

/**
 * Contract instances for Experiment 3.
 *
 * The same READ / WRITE split Experiment 1 established:
 *
 *   READ   provider-connected — view calls, no gas, no MetaMask popup
 *   WRITE  signer-connected   — state changes, costs gas, needs a signature
 *
 * Addresses and ABIs come from `contractConfig.js`; nothing is hardcoded here.
 */

/** MockUSDC — the ERC-20 underlying asset. Read-only. */
export const getUsdcRead = (provider) => new Contract(USDC_ADDRESS, MOCK_USDC_ABI, provider);

/** MockUSDC — signer-connected, for `approve()` and the owner-only `mint()`. */
export const getUsdcWrite = async (provider) =>
  new Contract(USDC_ADDRESS, MOCK_USDC_ABI, await provider.getSigner());

/** VaultWiseVault — the ERC-4626 vault. Read-only. */
export const getVaultRead = (provider) =>
  new Contract(VAULT_4626_ADDRESS, VAULT_4626_ABI, provider);

/** VaultWiseVault — signer-connected, for deposit/mint/withdraw/redeem. */
export const getVaultWrite = async (provider) =>
  new Contract(VAULT_4626_ADDRESS, VAULT_4626_ABI, await provider.getSigner());

/**
 * Log sources for decoding a receipt.
 *
 * Both contracts are ERC-20s, so their `Transfer` signatures are identical and
 * logs must be matched on the emitting address rather than the event topic.
 */
export const logSources = (provider) => [
  { name: "MockUSDC", address: USDC_ADDRESS, iface: getUsdcRead(provider).interface },
  {
    name: "VaultWiseVault",
    address: VAULT_4626_ADDRESS,
    iface: getVaultRead(provider).interface,
  },
];
