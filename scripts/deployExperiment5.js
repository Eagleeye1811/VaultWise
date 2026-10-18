import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

import { deployConfirmed, sendConfirmed } from "./lib/txSafety.js";

/**
 * VaultWise — Experiment 5 deployment script (yield farming + staking).
 *
 * Follows the experiment sheet's interaction sequence up to the point where
 * the user takes over:
 *
 *   Part 1 — Yield farming
 *     1. MockERC20("LP Token", "LPT")
 *     2. MockERC20("Reward Token", "RWD")
 *     3. mint 100 LPT to the deployer (the test user)
 *     4. SimpleYieldFarm(LPT, RWD)
 *     5. mint 1 000 RWD directly to the farm (reward funding)
 *
 *   Part 2 — Protocol staking
 *     6. MockERC20("Protocol Token", "ABC")
 *     7. MockERC20("Reward Token", "RWD")      (a separate RWD, as the sheet deploys)
 *     8. mint 100 ABC to the deployer
 *     9. SimpleStaking(ABC, RWD)
 *    10. mint 1 000 RWD directly to the staking contract
 *
 * It does NOT approve, stake, harvest or withdraw — those are the experiment
 * itself, done in Remix or the VaultWise UI. MockERC20 is the Experiment 4
 * source, reused unchanged; no Experiment 1/3/4 contract is touched.
 *
 * 1 000 RWD pays a 100-token stake for 10 000 s (~2.8 h) at 0.001 RWD/token/s.
 * The RWD owner (the deployer) can top a pool up at any time from the UI.
 *
 * Usage
 * -----
 *   npx hardhat run scripts/deployExperiment5.js                     # local, in-process
 *   npx hardhat run scripts/deployExperiment5.js --network sepolia   # Sepolia (costs gas)
 *
 * Sepolia secrets live in Hardhat's encrypted keystore, never in this repo:
 *
 *   npx hardhat keystore set SEPOLIA_RPC_URL
 *   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
 *
 * The deployment record goes to deployments/<network>-experiment5.json and is
 * saved after EVERY confirmed step (status "partial" until the end), so an
 * interrupted run can be completed with scripts/resumeExperiment5.js. An
 * existing record is never overwritten — a timestamped file is used instead.
 *
 * Transactions are sent strictly one at a time (scripts/lib/txSafety.js):
 * no pending tx → send → receipt status 1 → idle again. This matters on
 * Sepolia for EIP-7702 delegated accounts, which nodes limit to one in-flight
 * transaction.
 */

const STAKE_WHOLE_TOKENS = 100n;
const FUND_WHOLE_RWD = 1_000n;
const TOTAL_STEPS = 10;

const { ethers, networkName } = await network.getOrCreate();

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
const chainId = (await ethers.provider.getNetwork()).chainId;
const T = (whole) => ethers.parseUnits(whole.toString(), 18);

console.log("\nVaultWise — Experiment 5 deployment (yield farming + staking)");
console.log("=============================================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(
    `Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet before deploying.`
  );
}

const MockERC20 = await ethers.getContractFactory("MockERC20");
const ctx = { provider: ethers.provider, from: deployer.address };
let stepNumber = 0;

// ---------------------------------------------------------------------------
// Record — chosen up front and saved after every step
// ---------------------------------------------------------------------------
mkdirSync("deployments", { recursive: true });
let recordPath = `deployments/${networkName}-experiment5.json`;
if (existsSync(recordPath) && networkName !== "default") {
  recordPath = `deployments/${networkName}-experiment5-${Date.now()}.json`;
  console.log(`\nAn earlier Experiment 5 record exists; keeping it and writing ${recordPath} instead.`);
}
const record = {
  experiment: 5,
  network: networkName,
  chainId: Number(chainId),
  status: "partial",
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  rewardRate: "1e15 RWD base units per whole staked token per second (0.001 RWD)",
  yieldFarming: {},
  staking: {},
};
const save = () => writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
const tokenEntry = ({ address, txHash, name, symbol }) => ({ address, txHash, name, symbol });

/** Deploy one MockERC20 and print its details. */
async function deployToken(name, symbol) {
  stepNumber += 1;
  console.log(`\n[${stepNumber}/${TOTAL_STEPS}] Deploying MockERC20("${name}", "${symbol}") ...`);
  const { contract: token, address, txHash } = await deployConfirmed({
    label: `deploy ${symbol}`,
    factory: MockERC20,
    args: [name, symbol],
    getCreateAddress: ethers.getCreateAddress,
    ...ctx,
  });
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
  return { token, address, txHash, name, symbol };
}

/** Mint and verify the recipient's balance grew by exactly that amount. */
async function mintChecked(label, { token, symbol }, to, whole) {
  stepNumber += 1;
  console.log(`\n[${stepNumber}/${TOTAL_STEPS}] Minting ${whole} ${symbol} to ${label} ...`);
  const before = await token.balanceOf(to);
  const { tx } = await sendConfirmed({ label: `mint ${symbol}`, ...ctx, send: () => token.mint(to, T(whole)) });
  const after = await token.balanceOf(to);
  if (after - before !== T(whole)) throw new Error(`${symbol} mint verification failed: got ${after - before}`);
  console.log(`      tx hash : ${tx.hash}  -> ${label} holds ${ethers.formatUnits(after, 18)} ${symbol}`);
  return tx.hash;
}

/** Deploy SimpleYieldFarm or SimpleStaking and check its wiring. */
async function deployPool(contractName, stakeToken, rewardToken) {
  stepNumber += 1;
  console.log(
    `\n[${stepNumber}/${TOTAL_STEPS}] Deploying ${contractName}(${stakeToken.symbol}, ${rewardToken.symbol}) ...`
  );
  const { contract: pool, address, txHash } = await deployConfirmed({
    label: `deploy ${contractName}`,
    factory: await ethers.getContractFactory(contractName),
    args: [stakeToken.address, rewardToken.address],
    getCreateAddress: ethers.getCreateAddress,
    ...ctx,
  });
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);

  // Refuse to report success on a bad wiring.
  const [wiredStake, wiredReward, rate, staked] = await Promise.all([
    pool.stakingToken(),
    pool.rewardToken(),
    pool.rewardRate(),
    pool.totalStaked(),
  ]);
  if (wiredStake !== stakeToken.address) throw new Error(`stakingToken() is ${wiredStake}, expected ${stakeToken.address}`);
  if (wiredReward !== rewardToken.address) throw new Error(`rewardToken() is ${wiredReward}, expected ${rewardToken.address}`);
  if (rate !== 10n ** 15n) throw new Error(`rewardRate() is ${rate}, expected 1e15`);
  if (staked !== 0n) throw new Error(`fresh ${contractName} reports totalStaked ${staked}`);
  console.log(`      stakingToken() = ${stakeToken.symbol} ✓  rewardToken() = ${rewardToken.symbol} ✓  rewardRate() = 1e15 ✓`);

  return { pool, address, txHash };
}

// ---------------------------------------------------------------------------
// Part 1 — Yield farming
// ---------------------------------------------------------------------------
console.log("\n── Part 1 — Yield farming ──────────────────────────────────");
const yf = record.yieldFarming;
const lpt = await deployToken("LP Token", "LPT");
yf.LPT = tokenEntry(lpt);
save();
const farmRwd = await deployToken("Reward Token", "RWD");
yf.RWD = tokenEntry(farmRwd);
save();
yf.mintLptTx = await mintChecked("the deployer", lpt, deployer.address, STAKE_WHOLE_TOKENS);
save();
const farm = await deployPool("SimpleYieldFarm", lpt, farmRwd);
yf.SimpleYieldFarm = { address: farm.address, txHash: farm.txHash, stakingToken: lpt.address, rewardToken: farmRwd.address };
save();
yf.fundRwdTx = await mintChecked("SimpleYieldFarm", farmRwd, farm.address, FUND_WHOLE_RWD);
save();

// ---------------------------------------------------------------------------
// Part 2 — Protocol staking
// ---------------------------------------------------------------------------
console.log("\n── Part 2 — Protocol staking ───────────────────────────────");
const st = record.staking;
const abc = await deployToken("Protocol Token", "ABC");
st.ABC = tokenEntry(abc);
save();
const stakingRwd = await deployToken("Reward Token", "RWD");
st.RWD = tokenEntry(stakingRwd);
save();
st.mintAbcTx = await mintChecked("the deployer", abc, deployer.address, STAKE_WHOLE_TOKENS);
save();
const staking = await deployPool("SimpleStaking", abc, stakingRwd);
st.SimpleStaking = { address: staking.address, txHash: staking.txHash, stakingToken: abc.address, rewardToken: stakingRwd.address };
save();
st.fundRwdTx = await mintChecked("SimpleStaking", stakingRwd, staking.address, FUND_WHOLE_RWD);
record.status = "complete";
save();

// ---------------------------------------------------------------------------
// Frontend configuration (the record has been saved after every step)
// ---------------------------------------------------------------------------
console.log(`\nDeployment record written to ${recordPath}`);
if (networkName === "default") {
  console.log(
    "\nNOTE: this ran on Hardhat's in-process chain, which disappears when the script exits." +
      "\nThese addresses are for checking the script only — do not put them in frontend/.env."
  );
}
console.log("\nAdd these to frontend/.env, then restart `npm run dev`:");
console.log("------------------------------------------------------------");
console.log(`VITE_LPT_ADDRESS=${lpt.address}`);
console.log(`VITE_FARM_RWD_ADDRESS=${farmRwd.address}`);
console.log(`VITE_YIELD_FARM_ADDRESS=${farm.address}`);
console.log(`VITE_ABC_ADDRESS=${abc.address}`);
console.log(`VITE_STAKING_RWD_ADDRESS=${stakingRwd.address}`);
console.log(`VITE_STAKING_ADDRESS=${staking.address}`);
console.log("------------------------------------------------------------\n");
