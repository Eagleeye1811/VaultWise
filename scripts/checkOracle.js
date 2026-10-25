import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";

import { ASSIGNMENTS, FEEDS, readFrontendEnv } from "./lib/oracleConfig.js";

/**
 * VaultWise — read-only PriceOracle check (no key, no keystore).
 *
 *     npm run verify:oracle
 *
 * Before deployment (VITE_ORACLE_ADDRESS unset): checks every Chainlink feed
 * in scripts/lib/oracleConfig.js is live and fresh, and that every token
 * address in the frontend env file holds code — i.e. that
 * `npm run deploy:oracle:sepolia` will pass its own checks.
 *
 * After deployment: also checks the oracle's code, owner and token list, and
 * that each configured token is priced by its assigned feed with a fresh
 * price. Exits non-zero on any problem.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const RPC_URL = process.env.SEPOLIA_RPC_URL_PUBLIC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const STATUS = ["Ok", "NoFeed", "InvalidPrice", "Stale"];
const AGGREGATOR_ABI = [
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
];
const same = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

const provider = new JsonRpcProvider(RPC_URL, 11155111, { staticNetwork: true });
const block = await provider.getBlock("latest");
const { env, source } = readFrontendEnv();
const problems = [];
const fail = (message) => {
  problems.push(message);
  console.log(`  [FAIL] ${message}`);
};

console.log(`\nVaultWise — PriceOracle check (Sepolia block ${block.number}, env ${source ?? "none"})`);

console.log("\nChainlink feeds");
for (const [key, feed] of Object.entries(FEEDS)) {
  try {
    const aggregator = new Contract(feed.address, AGGREGATOR_ABI, provider);
    const [description, decimals, round] = await Promise.all([aggregator.description(), aggregator.decimals(), aggregator.latestRoundData()]);
    const age = block.timestamp - Number(round[3]);
    if (description !== key) fail(`${key}: feed describes itself as "${description}"`);
    else if (round[1] <= 0n) fail(`${key}: non-positive answer`);
    else if (age > feed.maxStaleness) fail(`${key}: ${Math.round(age / 60)} min old, window ${feed.maxStaleness / 3600} h`);
    else console.log(`  [PASS] ${key.padEnd(11)} $${formatUnits(round[1], decimals).padEnd(16)} ${Math.round(age / 60)} min old (window ${feed.maxStaleness / 3600} h)`);
  } catch (error) {
    fail(`${key}: could not read ${feed.address} (${error.shortMessage ?? error.message})`);
  }
}

console.log("\nTokens");
const tokens = {};
for (const a of ASSIGNMENTS) {
  if (a.env === null) {
    tokens[a.label] = ETH_SENTINEL;
    console.log(`  [PASS] ${a.label.padEnd(14)} native ETH (sentinel)`);
    continue;
  }
  const address = env[a.env];
  if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? "")) {
    console.log(`  [SKIP] ${a.label.padEnd(14)} ${a.env} not set`);
    continue;
  }
  if ((await provider.getCode(address)) === "0x") fail(`${a.label}: no contract at ${address}`);
  else {
    tokens[a.label] = address;
    console.log(`  [PASS] ${a.label.padEnd(14)} ${address}`);
  }
}

const oracleAddress = env.VITE_ORACLE_ADDRESS;
if (!/^0x[a-fA-F0-9]{40}$/.test(oracleAddress ?? "")) {
  console.log("\nVITE_ORACLE_ADDRESS is not set — pre-deployment checks only.");
} else {
  console.log(`\nPriceOracle ${oracleAddress}`);
  const { abi } = JSON.parse(readFileSync(`${ROOT}artifacts/contracts/oracle/PriceOracle.sol/PriceOracle.json`, "utf8"));
  const oracle = new Contract(oracleAddress, abi, provider);
  if ((await provider.getCode(oracleAddress)) === "0x") fail("no contract at VITE_ORACLE_ADDRESS");
  else {
    console.log(`  owner        : ${await oracle.owner()}`);
    console.log(`  tokens priced: ${await oracle.tokenCount()}`);
    for (const a of ASSIGNMENTS) {
      const token = tokens[a.label];
      if (!token) continue;
      const [[aggregator], [status, price, updatedAt]] = await Promise.all([oracle.feedOf(token), oracle.tryGetPrice(token)]);
      const expected = FEEDS[a.feed].address;
      if (!same(aggregator, expected)) fail(`${a.label}: priced by ${aggregator}, config says ${a.feed} (${expected})`);
      else if (status !== 0n) fail(`${a.label}: ${STATUS[Number(status)]}`);
      else {
        const age = Math.round((block.timestamp - Number(updatedAt)) / 60);
        console.log(`  [PASS] ${a.label.padEnd(14)} $${formatUnits(price, 18).padEnd(22)} ${a.feed.padEnd(11)} ${age} min old`);
      }
    }
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) found.\n`);
  process.exit(1);
}
console.log("\nAll checks passed.\n");
