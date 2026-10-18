import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { network } from "hardhat";

import { identify, loadRecord, saveRecord } from "./lib/experiment5State.js";
import { deployConfirmed, feeOverrides, sendConfirmed, waitForIdle } from "./lib/txSafety.js";

/**
 * VaultWise — Experiment 6 deployment script (DEX prototype).
 *
 * Deploys, in the sheet's build order:
 *
 *   1–3. DexMockERC20("Token A","DXA"), ("Token B","DXB"), ("Token C","DXC")
 *   4.   Factory
 *   5.   Router(Factory)
 *   6.   mint 10 000 DXA / DXB / DXC to the deployer (anyone can mint more)
 *
 * and checks the wiring before reporting success. It does NOT create pairs,
 * add liquidity or swap — that is the experiment itself, done in the UI or
 * Remix (the Router creates a pair automatically on the first addLiquidity).
 * The optional LPFarm is not deployed: it needs an existing pair's LP token.
 *
 * No Experiment 1/3/4/5 contract is touched.
 *
 *   npx hardhat run scripts/deployExperiment6.js                     # local, in-process
 *   npx hardhat run scripts/deployExperiment6.js --network sepolia   # Sepolia (costs gas)
 *
 * Sepolia secrets come from the encrypted Hardhat keystore:
 *   npx hardhat keystore set SEPOLIA_RPC_URL
 *   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
 *
 * Record and resume
 * -----------------
 * The record (deployments/<network>-experiment6.json) is saved after EVERY
 * confirmed step with status "partial". Re-running the script with a partial
 * record RESUMES it: each recorded contract is re-verified on-chain (bytecode,
 * deploy receipt, metadata, wiring) and skipped, and only the missing steps
 * are sent. It refuses to continue if the deployer created an Experiment 6
 * contract that is not in the record, so nothing is deployed twice. A
 * "complete" record is never overwritten — a fresh deployment goes to a
 * timestamped file.
 *
 * Fees and funds
 * --------------
 * Sepolia charges ~1 600 gas per byte of deployed code, so Factory (~20 M gas)
 * and Router (~12 M gas) are expensive. The priority fee is set explicitly
 * (PRIORITY_FEE_GWEI, default 0.1) instead of ethers' flat 1 gwei, and the
 * remaining steps are estimated up front: the script stops BEFORE sending
 * anything if the balance cannot cover them.
 *
 * Set DEPLOY_EXP6=plan to print the checks, plan and cost without sending.
 *
 * Transactions are sent strictly one at a time with receipt checks
 * (scripts/lib/txSafety.js) — required on Sepolia for EIP-7702 delegated
 * accounts, which nodes limit to one in-flight transaction.
 */

const MINT_WHOLE_TOKENS = 10_000n;
const TOTAL_STEPS = 6;
const PRIORITY_FEE_GWEI = process.env.PRIORITY_FEE_GWEI ?? "0.1";
const PLAN_ONLY = process.env.DEPLOY_EXP6 === "plan";
const TOKENS = [
  ["TokenA", "Token A", "DXA"],
  ["TokenB", "Token B", "DXB"],
  ["TokenC", "Token C", "DXC"],
];

const { ethers, networkName } = await network.getOrCreate();
const LIVE = networkName !== "default";
const provider = ethers.provider;

const [deployer] = await ethers.getSigners();
const balance = await provider.getBalance(deployer.address);
const chainId = (await provider.getNetwork()).chainId;
const amount = ethers.parseUnits(MINT_WHOLE_TOKENS.toString(), 18);
const same = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

console.log("\nVaultWise — Experiment 6 deployment (DEX prototype)");
console.log("===================================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(`Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet first.`);
}

const factories = {
  DexMockERC20: await ethers.getContractFactory("DexMockERC20"),
  Factory: await ethers.getContractFactory("Factory"),
  Router: await ethers.getContractFactory("Router"),
};
const ARTIFACTS = Object.fromEntries(
  Object.keys(factories).map((name) => [
    name,
    JSON.parse(readFileSync(`artifacts/contracts/experiment6/${name}.sol/${name}.json`, "utf8")),
  ])
);

// ---------------------------------------------------------------------------
// Record — resume a partial one, never overwrite a complete one
// ---------------------------------------------------------------------------
mkdirSync("deployments", { recursive: true });
let recordPath = `deployments/${networkName}-experiment6.json`;
let record;
if (LIVE && existsSync(recordPath) && loadRecord(recordPath).status !== "complete") {
  record = loadRecord(recordPath);
  console.log(`\nResuming the partial record ${recordPath}`);
} else {
  if (LIVE && existsSync(recordPath)) {
    recordPath = `deployments/${networkName}-experiment6-${Date.now()}.json`;
    console.log(`\nA complete Experiment 6 record exists; keeping it and writing ${recordPath} instead.`);
  }
  record = {
    experiment: 6,
    network: networkName,
    chainId: Number(chainId),
    status: "partial",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {},
    mint: { to: deployer.address, wholeTokensEach: MINT_WHOLE_TOKENS.toString(), txHashes: {} },
  };
}
const save = () => (PLAN_ONLY ? undefined : saveRecord(record, recordPath));

if (!same(record.deployer, deployer.address)) {
  throw new Error(`The record's deployer is ${record.deployer} but the signer is ${deployer.address}. Stopping.`);
}
if (record.chainId !== Number(chainId)) {
  throw new Error(`The record is for chain ${record.chainId}, connected to ${chainId}. Stopping.`);
}

// ---------------------------------------------------------------------------
// Re-verify everything already recorded
// ---------------------------------------------------------------------------
/** Check a recorded contract against the chain; returns its deploy nonce. */
async function verifyRecorded(key, expectedName) {
  const entry = record.contracts[key];
  const code = await provider.getCode(entry.address);
  const found = identify(code, ARTIFACTS);
  if (found !== expectedName) throw new Error(`${key} at ${entry.address}: on-chain code is ${found ?? "empty"}, expected ${expectedName}`);
  const [receipt, tx] = await Promise.all([
    provider.getTransactionReceipt(entry.txHash),
    provider.getTransaction(entry.txHash),
  ]);
  if (!receipt || receipt.status !== 1 || !same(receipt.from, deployer.address) || !same(receipt.contractAddress, entry.address)) {
    throw new Error(`${key}: deploy receipt ${entry.txHash} does not match (status ${receipt?.status}, from ${receipt?.from}, created ${receipt?.contractAddress})`);
  }
  console.log(`  [PASS] ${key.padEnd(7)} ${entry.address}  ${expectedName}, receipt status 1 (nonce ${tx.nonce})`);
  return tx.nonce;
}

const nonces = [];
const contracts = {};
if (Object.keys(record.contracts).length) console.log("\nVerifying the recorded contracts");
for (const [key, name, symbol] of TOKENS) {
  if (!record.contracts[key]) continue;
  nonces.push(await verifyRecorded(key, "DexMockERC20"));
  const token = factories.DexMockERC20.attach(record.contracts[key].address);
  if ((await token.name()) !== name || (await token.symbol()) !== symbol) throw new Error(`${key}: metadata is not ${name} / ${symbol}`);
  contracts[key] = token;
}
if (record.contracts.Factory) {
  nonces.push(await verifyRecorded("Factory", "Factory"));
  contracts.Factory = factories.Factory.attach(record.contracts.Factory.address);
}
if (record.contracts.Router) {
  nonces.push(await verifyRecorded("Router", "Router"));
  contracts.Router = factories.Router.attach(record.contracts.Router.address);
  const wired = await contracts.Router.factory();
  if (!same(wired, record.contracts.Factory?.address)) throw new Error(`Router.factory() is ${wired}, not the recorded Factory`);
}

// No unrecorded Experiment 6 contract may exist — that would be a duplicate.
const next = await waitForIdle(provider, deployer.address);
if (LIVE && nonces.length) {
  const recorded = new Set(Object.values(record.contracts).map((c) => c.address.toLowerCase()));
  for (let nonce = Math.min(...nonces); nonce < next; nonce += 1) {
    const address = ethers.getCreateAddress({ from: deployer.address, nonce });
    const name = identify(await provider.getCode(address), ARTIFACTS);
    if (name && name !== "unknown" && !recorded.has(address.toLowerCase())) {
      throw new Error(
        `The deployer created an unrecorded ${name} at ${address} (nonce ${nonce}). ` +
          "Add it to the record (after checking it) instead of deploying another. Stopping."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Plan, cost estimate and funds check — before anything is sent
// ---------------------------------------------------------------------------
const fees = await feeOverrides(provider, PRIORITY_FEE_GWEI);
const PLACEHOLDER = deployer.address; // only for estimating Router's constructor
const plan = [];
for (const [key, name, symbol] of TOKENS) {
  if (!contracts[key]) plan.push({ key, label: `Deploy DexMockERC20("${name}", "${symbol}")`, deploy: ["DexMockERC20", [name, symbol]] });
}
if (!contracts.Factory) plan.push({ key: "Factory", label: "Deploy Factory", deploy: ["Factory", []] });
if (!contracts.Router) plan.push({ key: "Router", label: "Deploy Router(Factory)", deploy: ["Router", [PLACEHOLDER]] });
for (const [key, , symbol] of TOKENS) {
  const minted = record.mint.txHashes[symbol] || (contracts[key] && (await contracts[key].balanceOf(deployer.address)) >= amount);
  if (!minted) plan.push({ key, mint: symbol, label: `Mint ${MINT_WHOLE_TOKENS} ${symbol} to the deployer` });
}

let totalGas = 0n;
for (const item of plan) {
  if (item.deploy) {
    const [name, args] = item.deploy;
    item.gas = await provider.estimateGas({ ...(await factories[name].getDeployTransaction(...args)), from: deployer.address });
  } else {
    // A mint to a fresh holder; the token may not exist yet, so use a measured upper bound.
    item.gas = contracts[item.key]
      ? await contracts[item.key].mint.estimateGas(deployer.address, amount)
      : 300_000n;
  }
  totalGas += item.gas;
}
const worstCost = totalGas * fees.maxFeePerGas;

console.log(`\nFees      : priority ${ethers.formatUnits(fees.maxPriorityFeePerGas, "gwei")} gwei, max ${ethers.formatUnits(fees.maxFeePerGas, "gwei")} gwei (PRIORITY_FEE_GWEI)`);
console.log("Plan");
if (!plan.length) console.log("  nothing — every step is done");
for (const item of plan) console.log(`  · ${item.label.padEnd(42)} ~${item.gas.toLocaleString("en-US")} gas`);
console.log(`Estimate  : ${totalGas.toLocaleString("en-US")} gas, at most ${ethers.formatEther(worstCost)} ETH`);

if (worstCost > balance) {
  throw new Error(
    `Not enough ETH: the remaining steps can cost up to ${ethers.formatEther(worstCost)} ETH, ` +
      `the deployer has ${ethers.formatEther(balance)}. Nothing was sent. Top up from a Sepolia faucet ` +
      "(or lower PRIORITY_FEE_GWEI) and re-run — the record resumes where it stopped."
  );
}
if (PLAN_ONLY) {
  console.log("\nPlan only (DEPLOY_EXP6=plan). Nothing was sent; re-run without it to execute.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Execute the remaining steps, one confirmed transaction at a time
// ---------------------------------------------------------------------------
const stepOf = { TokenA: 1, TokenB: 2, TokenC: 3, Factory: 4, Router: 5 };
for (const item of plan.filter((i) => i.deploy)) {
  const [name, args] = item.deploy;
  const realArgs = item.key === "Router" ? [record.contracts.Factory.address] : args;
  console.log(`\n[${stepOf[item.key]}/${TOTAL_STEPS}] ${item.key === "Router" ? `Deploying Router(${realArgs[0]})` : `${item.label} ...`}`);
  const { contract, address, txHash } = await deployConfirmed({
    label: item.label,
    factory: factories[name],
    args: realArgs,
    overrides: fees,
    provider,
    from: deployer.address,
    getCreateAddress: ethers.getCreateAddress,
  });
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
  contracts[item.key] = contract;
  const token = TOKENS.find(([key]) => key === item.key);
  record.contracts[item.key] = token
    ? { address, txHash, name: token[1], symbol: token[2] }
    : { address, txHash, ...(item.key === "Router" ? { factory: realArgs[0] } : {}) };
  save();
}

const mints = plan.filter((i) => i.mint);
if (mints.length) console.log(`\n[6/${TOTAL_STEPS}] Minting ${MINT_WHOLE_TOKENS} of each token to the deployer ...`);
for (const { key, mint: symbol } of mints) {
  const token = contracts[key];
  const before = await token.balanceOf(deployer.address);
  const { tx } = await sendConfirmed({
    label: `mint ${symbol}`,
    provider,
    from: deployer.address,
    send: () => token.mint(deployer.address, amount, fees),
  });
  const after = await token.balanceOf(deployer.address);
  if (after - before !== amount) throw new Error(`${symbol} mint verification failed`);
  record.mint.txHashes[symbol] = tx.hash;
  save();
  console.log(`      ${symbol} tx : ${tx.hash}  -> ${ethers.formatUnits(after, 18)} ${symbol}`);
}

// Refuse to report success on a bad wiring.
const factory = contracts.Factory;
const router = contracts.Router;
const factoryAddress = record.contracts.Factory.address;
const wiredFactory = await router.factory();
const pairs = await factory.allPairsLength();
if (!same(wiredFactory, factoryAddress)) throw new Error(`Router.factory() is ${wiredFactory}, expected ${factoryAddress}`);
console.log("\nVerification");
console.log(`  Router.factory()         : ${wiredFactory}  (matches Factory)`);
console.log(`  Factory.allPairsLength() : ${pairs}${pairs === 0n ? "  (no pairs yet, as expected)" : ""}`);
console.log(`  Router.getAmountOut(100, 1000, 2000) : ${await router.getAmountOut(100n, 1000n, 2000n)}  (sheet: 181)`);

record.status = "complete";
save();
console.log(`\nDeployment record written to ${recordPath}`);

if (!LIVE) {
  console.log(
    "\nNOTE: this ran on Hardhat's in-process chain, which disappears when the script exits." +
      "\nThese addresses are for checking the script only — do not put them in frontend/.env."
  );
}
const c = record.contracts;
console.log("\nAdd these to frontend/.env, then restart `npm run dev`:");
console.log("------------------------------------------------------------");
console.log(`VITE_DEX_FACTORY_ADDRESS=${c.Factory.address}`);
console.log(`VITE_DEX_ROUTER_ADDRESS=${c.Router.address}`);
console.log(`VITE_DEX_TOKEN_A_ADDRESS=${c.TokenA.address}`);
console.log(`VITE_DEX_TOKEN_B_ADDRESS=${c.TokenB.address}`);
console.log(`VITE_DEX_TOKEN_C_ADDRESS=${c.TokenC.address}`);
console.log("------------------------------------------------------------\n");
