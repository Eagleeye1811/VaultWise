import { readFileSync } from "node:fs";

/**
 * VaultWise — which Chainlink feed prices which platform token.
 *
 * Shared by scripts/deployOracle.js (writes it on-chain) and
 * scripts/checkOracle.js (reads it back).
 *
 * The platform's tokens are testnet assets with no market of their own, so
 * each one is assigned a real Sepolia Chainlink feed as its reference price.
 * Stable-like tokens follow stablecoin feeds (which keeps the 1:1 classic
 * pool near its oracle price), the DEX tokens follow three volatile majors,
 * and the protocol and reward tokens follow small-cap feeds.
 *
 * `maxStaleness` sits about one update above each feed's heartbeat, measured
 * on Sepolia: ETH, BTC, LINK and SNX update hourly, USDC, DAI and FORTH daily.
 * `localAnswer` (8 decimals) is only used by the in-process dry run.
 *
 * Feed addresses: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
 */

const HOUR = 3600;

export const FEEDS = {
  "ETH / USD": { address: "0x694AA1769357215DE4FAC081bf1f309aDC325306", maxStaleness: 2 * HOUR, localAnswer: 2349_50000000n },
  "BTC / USD": { address: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43", maxStaleness: 2 * HOUR, localAnswer: 80609_94899436n },
  "LINK / USD": { address: "0xc59E3633BAAC79493d908e63626716e204A45EdF", maxStaleness: 2 * HOUR, localAnswer: 11_47700000n },
  "SNX / USD": { address: "0xc0F82A46033b8BdBA4Bb0B0e28Bc2006F64355bC", maxStaleness: 2 * HOUR, localAnswer: 19794655n },
  "USDC / USD": { address: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E", maxStaleness: 26 * HOUR, localAnswer: 99984576n },
  "DAI / USD": { address: "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19", maxStaleness: 26 * HOUR, localAnswer: 99954553n },
  "FORTH / USD": { address: "0x070bF128E88A4520b3EfA65AB1e4Eb6F0F9E6632", maxStaleness: 26 * HOUR, localAnswer: 19240324n },
};

/** `env: null` is native ETH, priced under PriceOracle.ETH. */
export const ASSIGNMENTS = [
  { label: "ETH", env: null, feed: "ETH / USD" },
  { label: "USDC", env: "VITE_USDC_ADDRESS", feed: "USDC / USD" },
  { label: "TKA", env: "VITE_TOKEN_A_ADDRESS", feed: "DAI / USD" },
  { label: "TKB", env: "VITE_TOKEN_B_ADDRESS", feed: "USDC / USD" },
  { label: "DXA", env: "VITE_DEX_TOKEN_A_ADDRESS", feed: "ETH / USD" },
  { label: "DXB", env: "VITE_DEX_TOKEN_B_ADDRESS", feed: "BTC / USD" },
  { label: "DXC", env: "VITE_DEX_TOKEN_C_ADDRESS", feed: "LINK / USD" },
  { label: "LPT", env: "VITE_LPT_ADDRESS", feed: "ETH / USD" },
  { label: "ABC", env: "VITE_ABC_ADDRESS", feed: "FORTH / USD" },
  { label: "RWD (farm)", env: "VITE_FARM_RWD_ADDRESS", feed: "SNX / USD" },
  { label: "RWD (staking)", env: "VITE_STAKING_RWD_ADDRESS", feed: "SNX / USD" },
];

const ROOT = new URL("../..", import.meta.url).pathname;

/** VITE_* variables from frontend/.env.local, else frontend/.env. */
export function readFrontendEnv() {
  for (const candidate of ["frontend/.env.local", "frontend/.env"]) {
    let contents;
    try {
      contents = readFileSync(`${ROOT}${candidate}`, "utf8");
    } catch {
      continue;
    }
    const env = Object.fromEntries(
      contents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const splitAt = line.indexOf("=");
          return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()];
        })
    );
    return { env, source: candidate };
  }
  return { env: {}, source: null };
}
