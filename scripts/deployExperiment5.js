import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

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
 * The deployment record goes to deployments/<network>-experiment5.json. An
 * existing record is never overwritten — a timestamped file is written instead.
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
let stepNumber = 0;

/** Deploy one MockERC20 and print its details. */
async function deployToken(name, symbol) {
  stepNumber += 1;
  console.log(`\n[${stepNumber}/${TOTAL_STEPS}] Deploying MockERC20("${name}", "${symbol}") ...`);
  const token = await MockERC20.deploy(name, symbol);
  await token.waitForDeployment();
  const address = await token.getAddress();
  const txHash = token.deploymentTransaction().hash;
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
  return { token, address, txHash, name, symbol };
}

/** Mint and verify the recipient's balance grew by exactly that amount. */
async function mintChecked(label, { token, symbol }, to, whole) {
  stepNumber += 1;
  console.log(`\n[${stepNumber}/${TOTAL_STEPS}] Minting ${whole} ${symbol} to ${label} ...`);
  const before = await token.balanceOf(to);
  const tx = await token.mint(to, T(whole));
  await tx.wait();
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
  const Pool = await ethers.getContractFactory(contractName);
  const pool = await Pool.deploy(stakeToken.address, rewardToken.address);
  await pool.waitForDeployment();
  const address = await pool.getAddress();
  const txHash = pool.deploymentTransaction().hash;
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
const lpt = await deployToken("LP Token", "LPT");
const farmRwd = await deployToken("Reward Token", "RWD");
const lptMintTx = await mintChecked("the deployer", lpt, deployer.address, STAKE_WHOLE_TOKENS);
const farm = await deployPool("SimpleYieldFarm", lpt, farmRwd);
const farmFundTx = await mintChecked("SimpleYieldFarm", farmRwd, farm.address, FUND_WHOLE_RWD);

// ---------------------------------------------------------------------------
// Part 2 — Protocol staking
// ---------------------------------------------------------------------------
console.log("\n── Part 2 — Protocol staking ───────────────────────────────");
const abc = await deployToken("Protocol Token", "ABC");
const stakingRwd = await deployToken("Reward Token", "RWD");
const abcMintTx = await mintChecked("the deployer", abc, deployer.address, STAKE_WHOLE_TOKENS);
const staking = await deployPool("SimpleStaking", abc, stakingRwd);
const stakingFundTx = await mintChecked("SimpleStaking", stakingRwd, staking.address, FUND_WHOLE_RWD);

// ---------------------------------------------------------------------------
// Record + frontend configuration
// ---------------------------------------------------------------------------
const token = ({ address, txHash, name, symbol }) => ({ address, txHash, name, symbol });
const record = {
  experiment: 5,
  network: networkName,
  chainId: Number(chainId),
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  rewardRate: "1e15 RWD base units per whole staked token per second (0.001 RWD)",
  yieldFarming: {
    LPT: token(lpt),
    RWD: token(farmRwd),
    SimpleYieldFarm: { address: farm.address, txHash: farm.txHash, stakingToken: lpt.address, rewardToken: farmRwd.address },
    mintLptTx: lptMintTx,
    fundRwdTx: farmFundTx,
  },
  staking: {
    ABC: token(abc),
    RWD: token(stakingRwd),
    SimpleStaking: { address: staking.address, txHash: staking.txHash, stakingToken: abc.address, rewardToken: stakingRwd.address },
    mintAbcTx: abcMintTx,
    fundRwdTx: stakingFundTx,
  },
};

mkdirSync("deployments", { recursive: true });
// A separate file per experiment, and never on top of an existing record.
let recordPath = `deployments/${networkName}-experiment5.json`;
if (existsSync(recordPath) && networkName !== "default") {
  recordPath = `deployments/${networkName}-experiment5-${Date.now()}.json`;
  console.log(`\nAn earlier Experiment 5 record exists; keeping it and writing ${recordPath} instead.`);
}
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

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
