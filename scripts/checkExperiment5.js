import { JsonRpcProvider, formatEther } from "ethers";

import { RECORD_PATH, inspect, loadRecord, printReport } from "./lib/experiment5State.js";

/**
 * VaultWise — Experiment 5 Sepolia check (READ-ONLY: no key, no gas).
 *
 *   npm run verify:exp5                    # uses deployments/sepolia-experiment5.json
 *   node scripts/checkExperiment5.js path/to/record.json
 *
 * Reports, from the chain alone, which of the ten deployment steps are done,
 * with bytecode, owner, wiring, balance and receipt checks — see
 * scripts/lib/experiment5State.js. Exits non-zero on any problem.
 *
 * Set SEPOLIA_RPC_URL in the environment to use your own endpoint; otherwise
 * public endpoints are tried in turn. (The keystore is not read.)
 */

const ENDPOINTS = [
  process.env.SEPOLIA_RPC_URL,
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc.sepolia.org",
].filter(Boolean);

async function connect() {
  for (const url of ENDPOINTS) {
    try {
      const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
      await provider.getBlockNumber();
      return { provider, url: url === process.env.SEPOLIA_RPC_URL ? "SEPOLIA_RPC_URL" : url };
    } catch {
      // try the next endpoint
    }
  }
  throw new Error("Could not reach any Sepolia RPC endpoint.");
}

const path = process.argv[2] ?? RECORD_PATH;
const record = loadRecord(path);
const { provider, url } = await connect();

console.log("\nVaultWise — Experiment 5 Sepolia check (read-only)");
console.log("==================================================");
console.log(`Record:   ${path}${record.status ? `  (status: ${record.status})` : ""}`);
console.log(`RPC:      ${url} — block ${await provider.getBlockNumber()}`);
console.log(`Deployer: ${record.deployer}  ·  ${formatEther(await provider.getBalance(record.deployer))} ETH`);

const report = await inspect(provider, record);
printReport(report);
process.exitCode = report.ok ? 0 : 1;
