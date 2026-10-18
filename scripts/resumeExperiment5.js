import { network } from "hardhat";

import { ARTIFACTS, inspect, loadRecord, printReport, saveRecord } from "./lib/experiment5State.js";
import { deployConfirmed, sendConfirmed } from "./lib/txSafety.js";

/**
 * VaultWise — resume a partial Experiment 5 Sepolia deployment.
 *
 * Completes ONLY Part 2's remaining steps, from deployments/sepolia-experiment5.json:
 *
 *    8. mint 100 ABC to the deployer          (skipped if it already holds ≥ 100)
 *    9. deploy SimpleStaking(ABC, RWD)        (skipped if recorded, or if the deployer
 *                                              already created exactly one — it is adopted)
 *   10. mint 1 000 RWD to SimpleStaking       (skipped if it already holds ≥ 1 000)
 *
 * It refuses to run if steps 1–7 are not all verified on-chain — it never
 * redeploys Part 1 or the Part 2 tokens — or if anything is inconsistent
 * (wrong bytecode, owner, wiring, a duplicate SimpleStaking, a pending
 * transaction, a signer that is not the token owner).
 *
 * DRY RUN by default: it inspects and prints the plan, and sends nothing.
 *
 *   npx hardhat run scripts/resumeExperiment5.js --network sepolia                       # plan only
 *   RESUME_EXP5=send npx hardhat run scripts/resumeExperiment5.js --network sepolia      # execute
 *
 * Transactions go out strictly one at a time (scripts/lib/txSafety.js):
 * wait for no pending tx → send → receipt status 1 → idle again. The record is
 * saved after every confirmed step, so an interruption loses nothing.
 */

const SEND = process.env.RESUME_EXP5 === "send";
const T = (whole) => 10n ** 18n * BigInt(whole);

const { ethers, networkName } = await network.getOrCreate();
if (networkName !== "sepolia") throw new Error(`Run with --network sepolia (got ${networkName}).`);

const record = loadRecord();
const [signer] = await ethers.getSigners();
const provider = ethers.provider;

console.log("\nVaultWise — resume Experiment 5 on Sepolia");
console.log("==========================================");
console.log(`Mode     : ${SEND ? "SEND (transactions will be signed)" : "DRY RUN (nothing is sent)"}`);
console.log(`Signer   : ${signer.address}`);
console.log(`Deployer : ${record.deployer}  (from the record)`);
console.log(`Balance  : ${ethers.formatEther(await provider.getBalance(signer.address))} ETH`);

/** Inspect, print, and stop on any problem. */
async function verifiedState() {
  const report = await inspect(provider, record);
  printReport(report);
  if (!report.ok) throw new Error("Inconsistent on-chain state — stopping before sending anything.");
  return report;
}

let report = await verifiedState();
const done = (n) => report.steps.find((s) => s.n === n).done;

if (signer.address.toLowerCase() !== record.deployer.toLowerCase()) {
  throw new Error(`The keystore signer ${signer.address} is not the deployer/token owner ${record.deployer}.`);
}
const missingEarly = report.steps.filter((s) => s.n <= 7 && !s.done);
if (missingEarly.length) {
  throw new Error(
    `Steps ${missingEarly.map((s) => s.n).join(", ")} are not verified on-chain. This script only completes steps 8–10; ` +
      "it will not redeploy Part 1 or the Part 2 tokens. Fix the record (addresses/hashes) first."
  );
}

const todo = report.steps.filter((s) => s.n >= 8 && !s.done);
console.log(`\nPlan: ${todo.length ? todo.map((s) => `step ${s.n} (${s.label})`).join(", then ") : "nothing — all steps done"}`);

// Adopt a SimpleStaking the deployer already created but the record lacks.
if (!record.staking.SimpleStaking?.address && report.facts.stakingAddress) {
  record.staking.SimpleStaking = { address: report.facts.stakingAddress, txHash: null, adopted: true };
  console.log(`Adopting the existing SimpleStaking at ${report.facts.stakingAddress} (no redeploy).`);
  if (SEND) saveRecord(record);
}

if (!SEND) {
  console.log("\nDry run complete. Nothing was sent. To execute the plan above:");
  console.log("  RESUME_EXP5=send npx hardhat run scripts/resumeExperiment5.js --network sepolia\n");
  process.exit(0);
}

const abc = await ethers.getContractAt(ARTIFACTS.MockERC20.abi, record.staking.ABC.address);
const rwd = await ethers.getContractAt(ARTIFACTS.MockERC20.abi, record.staking.RWD.address);
const ctx = { provider, from: signer.address };

// ---- step 8 ---------------------------------------------------------------
if (!done(8)) {
  console.log("\n[8/10] Minting 100 ABC to the deployer ...");
  const before = await abc.balanceOf(signer.address);
  if (before >= T(100)) {
    console.log("      already holds ≥ 100 ABC — skipped");
  } else {
    const { tx } = await sendConfirmed({ label: "mint ABC", ...ctx, send: () => abc.mint(signer.address, T(100)) });
    const after = await abc.balanceOf(signer.address);
    if (after - before !== T(100)) throw new Error(`ABC balance grew by ${after - before}, expected 100e18`);
    record.staking.mintAbcTx = tx.hash;
    saveRecord(record);
  }
}

// ---- step 9 ---------------------------------------------------------------
report = await verifiedState(); // re-check: nothing changed underneath us
if (!done(9)) {
  console.log("\n[9/10] Deploying SimpleStaking(ABC, RWD) ...");
  const deployed = await deployConfirmed({
    label: "deploy SimpleStaking",
    factory: await ethers.getContractFactory("SimpleStaking"),
    args: [record.staking.ABC.address, record.staking.RWD.address],
    getCreateAddress: ethers.getCreateAddress,
    ...ctx,
  });
  record.staking.SimpleStaking = {
    address: deployed.address,
    txHash: deployed.txHash,
    stakingToken: record.staking.ABC.address,
    rewardToken: record.staking.RWD.address,
  };
  saveRecord(record);
}

// ---- step 10 --------------------------------------------------------------
report = await verifiedState();
if (!done(10)) {
  const stakingAddress = record.staking.SimpleStaking.address;
  console.log(`\n[10/10] Minting 1 000 RWD to SimpleStaking ${stakingAddress} ...`);
  const before = await rwd.balanceOf(stakingAddress);
  const needed = T(1000) - before;
  const { tx } = await sendConfirmed({ label: "fund SimpleStaking", ...ctx, send: () => rwd.mint(stakingAddress, needed) });
  if ((await rwd.balanceOf(stakingAddress)) < T(1000)) throw new Error("SimpleStaking funding verification failed");
  record.staking.fundRwdTx = tx.hash;
  saveRecord(record);
}

// ---- final ----------------------------------------------------------------
report = await verifiedState();
if (report.steps.some((s) => !s.done)) throw new Error("Not every step verified after resuming.");
record.status = "complete";
record.completedAt = new Date().toISOString();
saveRecord(record);

console.log("\nExperiment 5 deployment complete. Add these to frontend/.env:");
console.log("------------------------------------------------------------");
console.log(`VITE_LPT_ADDRESS=${record.yieldFarming.LPT.address}`);
console.log(`VITE_FARM_RWD_ADDRESS=${record.yieldFarming.RWD.address}`);
console.log(`VITE_YIELD_FARM_ADDRESS=${record.yieldFarming.SimpleYieldFarm.address}`);
console.log(`VITE_ABC_ADDRESS=${record.staking.ABC.address}`);
console.log(`VITE_STAKING_RWD_ADDRESS=${record.staking.RWD.address}`);
console.log(`VITE_STAKING_ADDRESS=${record.staking.SimpleStaking.address}`);
console.log("------------------------------------------------------------\n");
