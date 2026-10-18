import { Contract } from "ethers";

import {
  DEX_FACTORY_ABI,
  DEX_FACTORY_ADDRESS,
  DEX_PAIR_ABI,
  DEX_ROUTER_ABI,
  DEX_ROUTER_ADDRESS,
  DEX_TOKEN_ABI,
  DEX_TOKEN_ADDRESSES,
} from "../../contracts/contractConfig";

/**
 * Contract instances and constants for Experiment 6.
 *
 * Same READ / WRITE split as Experiments 3–5:
 *   READ   provider-connected — view calls, no gas, no MetaMask popup
 *   WRITE  signer-connected   — state changes, costs gas, needs a signature
 *
 * Tokens are addressed by key ("A" | "B" | "C"); the three possible pools by
 * pair key ("AB" | "BC" | "AC"). Pair addresses are never configured — they
 * are looked up from the Factory with getPair().
 */

export const TOKEN_KEYS = ["A", "B", "C"];

export const PAIR_KEYS = [
  { key: "AB", x: "A", y: "B" },
  { key: "BC", x: "B", y: "C" },
  { key: "AC", x: "A", y: "C" },
];

/** "AB" for ("A","B") or ("B","A"). */
export const pairKeyOf = (x, y) => PAIR_KEYS.find((p) => (p.x === x && p.y === y) || (p.x === y && p.y === x))?.key;

export const getTokenRead = (key, provider) => new Contract(DEX_TOKEN_ADDRESSES[key], DEX_TOKEN_ABI, provider);
export const getTokenWrite = async (key, provider) =>
  new Contract(DEX_TOKEN_ADDRESSES[key], DEX_TOKEN_ABI, await provider.getSigner());

export const getFactoryRead = (provider) => new Contract(DEX_FACTORY_ADDRESS, DEX_FACTORY_ABI, provider);
export const getFactoryWrite = async (provider) =>
  new Contract(DEX_FACTORY_ADDRESS, DEX_FACTORY_ABI, await provider.getSigner());

export const getRouterRead = (provider) => new Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, provider);
export const getRouterWrite = async (provider) =>
  new Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, await provider.getSigner());

export const getPairRead = (address, provider) => new Contract(address, DEX_PAIR_ABI, provider);
export const getPairWrite = async (address, provider) =>
  new Contract(address, DEX_PAIR_ABI, await provider.getSigner());

/** Interfaces for decoding a revert from any DEX contract. */
export const revertInterfaces = (provider) => [
  getRouterRead(provider).interface,
  getPairRead(DEX_ROUTER_ADDRESS, provider).interface,
  getFactoryRead(provider).interface,
  getTokenRead("A", provider).interface,
];

/** The pair-level events, as opposed to the ERC-20 Transfer/Approval they also emit. */
const DEX_EVENTS = new Set(["Mint", "Burn", "Swap", "Sync", "PairCreated"]);

/**
 * Log sources for decoding a receipt: the three tokens, the Factory, and
 * every known pair. All tokens and pairs are ERC-20s with identical Transfer
 * signatures, so logs are matched on emitting address.
 */
export function logSources(provider, symbols, pairs) {
  const sources = [
    ...TOKEN_KEYS.map((key) => ({
      name: symbols[key],
      address: DEX_TOKEN_ADDRESSES[key],
      iface: getTokenRead(key, provider).interface,
    })),
    {
      name: "Factory",
      address: DEX_FACTORY_ADDRESS,
      iface: getFactoryRead(provider).interface,
      standardOf: () => "DEX",
    },
  ];
  for (const { key, x, y } of PAIR_KEYS) {
    const address = pairs[key]?.address;
    if (!address) continue;
    sources.push({
      name: `Pair ${symbols[x]}/${symbols[y]}`,
      address,
      iface: getPairRead(address, provider).interface,
      standardOf: (eventName) => (DEX_EVENTS.has(eventName) ? "DEX" : undefined),
    });
  }
  return sources;
}
