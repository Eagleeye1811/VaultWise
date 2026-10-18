import { Contract } from "ethers";

import {
  AMM_ADDRESS,
  MOCK_ERC20_ABI,
  SIMPLE_AMM_ABI,
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
} from "../../contracts/contractConfig";

/**
 * Contract instances for Experiment 4.
 *
 * The same READ / WRITE split as the earlier experiments:
 *
 *   READ   provider-connected — view calls, no gas, no MetaMask popup
 *   WRITE  signer-connected   — state changes, costs gas, needs a signature
 *
 * Token A and Token B are two deployments of the same MockERC20 ABI, so they
 * are addressed by side ("A" | "B") rather than by separate helpers.
 */

const TOKEN_ADDRESS = { A: TOKEN_A_ADDRESS, B: TOKEN_B_ADDRESS };

/** TKA or TKB — read-only. */
export const getTokenRead = (side, provider) =>
  new Contract(TOKEN_ADDRESS[side], MOCK_ERC20_ABI, provider);

/** TKA or TKB — signer-connected, for `approve()` and the owner-only `mint()`. */
export const getTokenWrite = async (side, provider) =>
  new Contract(TOKEN_ADDRESS[side], MOCK_ERC20_ABI, await provider.getSigner());

/** SimpleAMM — read-only: reserves, quotes, LP balances. */
export const getAmmRead = (provider) => new Contract(AMM_ADDRESS, SIMPLE_AMM_ABI, provider);

/** SimpleAMM — signer-connected, for liquidity and swaps. */
export const getAmmWrite = async (provider) =>
  new Contract(AMM_ADDRESS, SIMPLE_AMM_ABI, await provider.getSigner());

/** The pool's own events, as opposed to the ERC-20 Transfer/Approval it also emits. */
const AMM_EVENTS = new Set(["LiquidityAdded", "LiquidityRemoved", "Swap", "Sync"]);

/**
 * Log sources for decoding a receipt.
 *
 * All three contracts are ERC-20s (the pool's vwLP shares too), so their
 * `Transfer` signatures are identical and logs are matched on emitting address.
 */
export const logSources = (provider, symbols = { A: "TKA", B: "TKB" }) => [
  { name: symbols.A, address: TOKEN_A_ADDRESS, iface: getTokenRead("A", provider).interface },
  { name: symbols.B, address: TOKEN_B_ADDRESS, iface: getTokenRead("B", provider).interface },
  {
    name: "SimpleAMM",
    address: AMM_ADDRESS,
    iface: getAmmRead(provider).interface,
    standardOf: (eventName) => (AMM_EVENTS.has(eventName) ? "AMM" : undefined),
  },
];
