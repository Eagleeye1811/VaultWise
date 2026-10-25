import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { network } from "hardhat";

import { identify, loadRecord, saveRecord } from "./lib/experiment5State.js";
import { deployConfirmed, feeOverrides, sendConfirmed, waitForIdle } from "./lib/txSafety.js";
import { ASSIGNMENTS, FEEDS, readFrontendEnv } from "./lib/oracleConfig.js";

/**
 * VaultWise — PriceOracle deployment.
 *
 *   1. Deploy PriceOracle (the deployer becomes its owner)
 *   2. setFeed(token, Chainlink feed, maxStaleness) for every platform token
 *      listed in scripts/lib/oracleConfig.js
 *
 *   npm run deploy:oracle            # dry run on the in-process chain (mock feeds + tokens)
 *   npm run deploy:oracle:sepolia    # Sepolia, real Chainlink feeds (costs gas)
 *
 * On Sepolia the token addresses come from frontend/.env.local (or
 * frontend/.env), so the oracle prices exactly the contracts the app uses.
 * Before anything is sent, every feed is checked live (description, decimals,
 * a fresh positive answer) and every token address must hold code.
 *
 * Re-running is safe: the record (deployments/<network>-oracle.json) keeps the
 * oracle's address, and a feed that is already registered with the same
 * aggregator and staleness window is skipped. So the same command resumes an
 * interrupted run, and after editing oracleConfig.js it applies only the
 * changes.
 *
 * Set DEPLOY_ORACLE=plan to print the checks, plan and cost without sending.
 * Transactions go one at a time with receipt checks (scripts/lib/txSafety.js).
 */

const PRIORITY_FEE_GWEI = process.env.PRIORITY_FEE_GWEI ?? "0.1";
const PLAN_ONLY = process.env.DEPLOY_ORACLE === "plan";
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const AGGREGATOR_ABI = [
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
];

const { ethers, networkName } = await network.getOrCreate();
const LIVE = networkName !== "default";
const provider = ethers.provider;
const same = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

const [deployer] = await ethers.getSigners();
const balance = await provider.getBalance(deployer.address);
const chainId = (await provider.getNetwork()).chainId;

console.log("\nVaultWise — PriceOracle deployment");
console.log("==================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(`Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet first.`);
}
if (LIVE && chainId !== 11155111n) {
  throw new Error(`The feed addresses in oracleConfig.js are Sepolia's; connected to chain ${chainId}. Stopping.`);
}

const OracleFactory = await ethers.getContractFactory("PriceOracle");
const ARTIFACTS = {
  PriceOracle: JSON.parse(readFileSync("artifacts/contracts/oracle/PriceOracle.sol/PriceOracle.json", "utf8")),
};

// ---------------------------------------------------------------------------
// Resolve feeds and tokens
// ---------------------------------------------------------------------------
const feeds = {}; // feed key -> { address, maxStaleness, description }
const tokens = {}; // assignment label -> address

if (LIVE) {
  const { env, source } = readFrontendEnv();
  if (!source) throw new Error("No frontend/.env.local or frontend/.env with token addresses found.");
  console.log(`Tokens    : read from ${source}`);
  for (const a of ASSIGNMENTS) {
    if (a.env === null) {
      tokens[a.label] = ETH_SENTINEL;
      continue;
    }
    const address = env[a.env];
    if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? "")) {
      console.log(`  [SKIP] ${a.label.padEnd(14)} ${a.env} is not set`);
      continue;
    }
    if ((await provider.getCode(address)) === "0x") throw new Error(`${a.label}: no contract at ${address} (${a.env}). Stopping.`);
    tokens[a.label] = address;
  }
  for (const [key, feed] of Object.entries(FEEDS)) feeds[key] = { ...feed };
} else {
  // In-process dry run: stand-in feeds and tokens so every step really executes.
  console.log("Tokens    : deploying local stand-ins (MockV3Aggregator, MockERC20, MockUSDC)");
  for (const [key, feed] of Object.entries(FEEDS)) {
    const mock = await ethers.deployContract("MockV3Aggregator", [8, feed.localAnswer, key]);
    feeds[key] = { ...feed, address: await mock.getAddress() };
  }
  for (const a of ASSIGNMENTS) {
    if (a.env === null) tokens[a.label] = ETH_SENTINEL;
    else if (a.label === "USDC") tokens[a.label] = await (await ethers.deployContract("MockUSDC")).getAddress();
    else tokens[a.label] = await (await ethers.deployContract("MockERC20", [a.label, a.label])).getAddress();
  }
}

console.log("\nChecking feeds");
const nowSeconds = (await provider.getBlock("latest")).timestamp;
for (const key of new Set(ASSIGNMENTS.filter((a) => tokens[a.label]).map((a) => a.feed))) {
  const feed = feeds[key];
  const aggregator = new ethers.Contract(feed.address, AGGREGATOR_ABI, provider);
  const [description, decimals, round] = await Promise.all([
    aggregator.description(),
    aggregator.decimals(),
    aggregator.latestRoundData(),
  ]);
  const age = nowSeconds - Number(round[3]);
  if (description !== key) throw new Error(`Feed ${feed.address} describes itself as "${description}", expected "${key}". Stopping.`);
  if (round[1] <= 0n) throw new Error(`${key}: non-positive answer ${round[1]}. Stopping.`);
  if (age > feed.maxStaleness) {
    throw new Error(`${key}: last round is ${Math.round(age / 60)} min old, beyond its ${feed.maxStaleness / 3600} h window. Try again later.`);
  }
  console.log(`  [PASS] ${key.padEnd(11)} ${feed.address}  $${ethers.formatUnits(round[1], decimals)}  (${Math.round(age / 60)} min old, window ${feed.maxStaleness / 3600} h)`);
}

// ---------------------------------------------------------------------------
// Record — reuse the recorded oracle if there is one
// ---------------------------------------------------------------------------
mkdirSync("deployments", { recursive: true });
const recordPath = `deployments/${networkName}-oracle.json`;
let record;
if (LIVE && existsSync(recordPath)) {
  record = loadRecord(recordPath);
  console.log(`\nUsing the record ${recordPath}`);
} else {
  record = {
    product: "PriceOracle",
    network: networkName,
    chainId: Number(chainId),
    status: "partial",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {},
    feeds: {},
  };
}
const save = () => (PLAN_ONLY || !LIVE ? undefined : saveRecord(record, recordPath));

if (record.chainId !== Number(chainId)) throw new Error(`The record is for chain ${record.chainId}, connected to ${chainId}. Stopping.`);

let oracle = null;
if (record.contracts.PriceOracle) {
  const { address } = record.contracts.PriceOracle;
  const found = identify(await provider.getCode(address), ARTIFACTS);
  if (found !== "PriceOracle") throw new Error(`Recorded PriceOracle ${address}: on-chain code is ${found ?? "empty"}. Stopping.`);
  oracle = OracleFactory.attach(address);
  const owner = await oracle.owner();
  if (!same(owner, deployer.address)) throw new Error(`PriceOracle ${address} is owned by ${owner}, not the signer ${deployer.address}. Stopping.`);
  console.log(`  [PASS] PriceOracle ${address}  owner is the deployer`);
}

await waitForIdle(provider, deployer.address);

// ---------------------------------------------------------------------------
// Plan, cost estimate and funds check — before anything is sent
// ---------------------------------------------------------------------------
const fees = await feeOverrides(provider, PRIORITY_FEE_GWEI);
const plan = [];
if (!oracle) {
  plan.push({ label: "Deploy PriceOracle", gas: await provider.estimateGas({ ...(await OracleFactory.getDeployTransaction()), from: deployer.address }) });
}
for (const a of ASSIGNMENTS) {
  const token = tokens[a.label];
  if (!token) continue;
  const feed = feeds[a.feed];
  if (oracle) {
    const [aggregator, maxStaleness] = await oracle.feedOf(token);
    if (same(aggregator, feed.address) && Number(maxStaleness) === feed.maxStaleness) {
      console.log(`  [DONE] ${a.label.padEnd(14)} already priced by ${a.feed}`);
      continue;
    }
  }
  // A fresh setFeed costs ~150k gas; the exact figure needs the oracle to exist.
  const gas = oracle ? await oracle.setFeed.estimateGas(token, feed.address, feed.maxStaleness) : 180_000n;
  plan.push({ label: `Price ${a.label} with ${a.feed}`, assignment: a, token, feed, gas });
}

const totalGas = plan.reduce((sum, item) => sum + item.gas, 0n);
const worstCost = totalGas * fees.maxFeePerGas;
console.log(`\nFees      : priority ${ethers.formatUnits(fees.maxPriorityFeePerGas, "gwei")} gwei, max ${ethers.formatUnits(fees.maxFeePerGas, "gwei")} gwei (PRIORITY_FEE_GWEI)`);
console.log("Plan");
if (!plan.length) console.log("  nothing — the oracle is deployed and every feed is set");
for (const item of plan) console.log(`  · ${item.label.padEnd(36)} ~${item.gas.toLocaleString("en-US")} gas`);
console.log(`Estimate  : ${totalGas.toLocaleString("en-US")} gas, at most ${ethers.formatEther(worstCost)} ETH`);

if (worstCost > balance) {
  throw new Error(
    `Not enough ETH: the plan can cost up to ${ethers.formatEther(worstCost)} ETH, the deployer has ${ethers.formatEther(balance)}. ` +
      "Nothing was sent. Top up from a Sepolia faucet (or lower PRIORITY_FEE_GWEI) and re-run."
  );
}
if (PLAN_ONLY) {
  console.log("\nPlan only (DEPLOY_ORACLE=plan). Nothing was sent; re-run without it to execute.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Execute, one confirmed transaction at a time
// ---------------------------------------------------------------------------
if (!oracle) {
  console.log("\nDeploying PriceOracle ...");
  const { contract, address, txHash } = await deployConfirmed({
    label: "Deploy PriceOracle",
    factory: OracleFactory,
    overrides: fees,
    provider,
    from: deployer.address,
    getCreateAddress: ethers.getCreateAddress,
  });
  oracle = contract;
  record.contracts.PriceOracle = { address, txHash };
  save();
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
}

for (const item of plan.filter((i) => i.assignment)) {
  const { assignment: a, token, feed } = item;
  console.log(`\n${item.label} ...`);
  const { tx } = await sendConfirmed({
    label: `setFeed ${a.label}`,
    provider,
    from: deployer.address,
    send: () => oracle.setFeed(token, feed.address, feed.maxStaleness, fees),
  });
  record.feeds[a.label] = { token, feed: a.feed, aggregator: feed.address, maxStaleness: feed.maxStaleness, txHash: tx.hash };
  save();
}

// Refuse to report success unless every configured token reads back a fresh price.
console.log("\nVerification");
for (const a of ASSIGNMENTS) {
  const token = tokens[a.label];
  if (!token) continue;
  const [price, updatedAt] = await oracle.getPrice(token);
  console.log(`  ${a.label.padEnd(14)} $${ethers.formatUnits(price, 18).padEnd(22)} ${a.feed.padEnd(11)} round ${new Date(Number(updatedAt) * 1000).toISOString()}`);
}

record.status = "complete";
save();
const oracleAddress = await oracle.getAddress();
if (LIVE) console.log(`\nDeployment record written to ${recordPath}`);
else {
  console.log(
    "\nNOTE: this ran on Hardhat's in-process chain with stand-in feeds and tokens, which disappear when the script exits." +
      "\nThe address below is for checking the script only — do not put it in frontend/.env."
  );
}
console.log("\nAdd this to your frontend env file, then restart `npm run dev`:");
console.log("------------------------------------------------------------");
console.log(`VITE_ORACLE_ADDRESS=${oracleAddress}`);
console.log("------------------------------------------------------------\n");
