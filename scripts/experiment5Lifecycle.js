import { network } from "hardhat";

/**
 * VaultWise — Experiment 5 lifecycle demonstration.
 *
 * Walks the experiment sheet's 13-step interaction sequence for BOTH parts —
 * yield farming (LPT -> SimpleYieldFarm) and protocol staking
 * (ABC -> SimpleStaking) — with the suggested test values:
 *
 *   mint 100, fund with RWD, approve + stake 100, wait ~60 s, earned() ≈ 6 RWD,
 *   harvest/claim, wait, withdraw/unstake 40 (60 remain), wait, exit()
 *
 * and prints every balance, stake, earned() value, event and tx hash. This is
 * the "console output" evidence the sheet asks for.
 *
 * Waiting: on Hardhat's in-process chain the 60 s waits are simulated by
 * advancing block time (instant and exact). On a live network such as Sepolia
 * the script really waits, so a run takes a few minutes and the elapsed times
 * — and therefore the rewards — include block-inclusion delay.
 *
 *   npx hardhat run scripts/experiment5Lifecycle.js                    # local
 *   npx hardhat run scripts/experiment5Lifecycle.js --network sepolia  # Sepolia (costs gas)
 *
 * It deploys its own fresh contracts so every run starts from a known state.
 */

const { ethers, networkName, networkHelpers } = await network.getOrCreate();
const LOCAL = networkName === "default";
const WAIT_SECONDS = 60;

const T = (whole) => ethers.parseUnits(String(whole), 18);
const fmt = (raw) => ethers.formatUnits(raw, 18);
const row = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);

let stepNumber = 0;
const step = (title) => {
  stepNumber += 1;
  console.log(`\n${"─".repeat(72)}`);
  console.log(`STEP ${stepNumber} — ${title}`);
  console.log("─".repeat(72));
};

const [account] = await ethers.getSigners(); // single test account, as in Remix

/** Let `seconds` pass: simulated locally, real-time on a live chain. */
async function wait(seconds) {
  if (LOCAL) {
    await networkHelpers.time.increase(seconds);
    row("time", `advanced ${seconds} s (simulated block time)`);
  } else {
    row("time", `waiting ${seconds} s in real time ...`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}

/** Send a tx, wait for it, print its hash and decoded events from `contracts`. */
async function send(label, promise, contracts) {
  const tx = await promise;
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  row(label, `tx ${tx.hash}`);
  row("mined", `block ${receipt.blockNumber} · timestamp ${block.timestamp}`);
  for (const log of receipt.logs) {
    for (const [name, contract] of contracts) {
      if (log.address.toLowerCase() !== (await contract.getAddress()).toLowerCase()) continue;
      const parsed = contract.interface.parseLog(log);
      if (!parsed) continue;
      const args = parsed.fragment.inputs
        .map((input, i) => {
          const value = parsed.args[i];
          return `${input.name}=${typeof value === "bigint" ? `${fmt(value)}` : value}`;
        })
        .join(", ");
      row("event", `${name}.${parsed.name}(${args})`);
    }
  }
  return { receipt, timestamp: block.timestamp };
}

async function runPart({ title, contractName, stake: [stakeName, sym], claimFn, withdrawFn }) {
  console.log(`\n${"═".repeat(72)}\n${title}\n${"═".repeat(72)}`);
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  step(`Deploy MockERC20 as ${stakeName} (${sym})`);
  const stk = await MockERC20.deploy(stakeName, sym);
  await stk.waitForDeployment();
  row(`${sym} address`, await stk.getAddress());
  row("tx", stk.deploymentTransaction().hash);

  step("Deploy MockERC20 again as Reward Token (RWD)");
  const rwd = await MockERC20.deploy("Reward Token", "RWD");
  await rwd.waitForDeployment();
  row("RWD address", await rwd.getAddress());
  row("tx", rwd.deploymentTransaction().hash);

  const events = () => [
    [sym, stk],
    ["RWD", rwd],
    [contractName, pool],
  ];
  let pool = null;

  step(`Mint 100 ${sym} to the test user`);
  await send("mint", stk.mint(account.address, T(100)), [[sym, stk]]);
  row(`${sym} balance`, fmt(await stk.balanceOf(account.address)));

  step(`Deploy ${contractName}(${sym}, RWD)`);
  pool = await (await ethers.getContractFactory(contractName)).deploy(await stk.getAddress(), await rwd.getAddress());
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  row(`${contractName} address`, poolAddress);
  row("tx", pool.deploymentTransaction().hash);
  row("rewardRate()", `${await pool.rewardRate()} base units = 0.001 RWD per ${sym} per second`);

  step(`Mint 1000 RWD directly to ${contractName} (reward funding)`);
  await send("mint", rwd.mint(poolAddress, T(1000)), [["RWD", rwd]]);
  row("pool RWD balance", fmt(await rwd.balanceOf(poolAddress)));

  step(`Approve ${contractName} to spend 100 ${sym}`);
  await send("approve", stk.approve(poolAddress, T(100)), events());
  row("allowance", fmt(await stk.allowance(account.address, poolAddress)));

  step("Call stake(100)");
  const { timestamp: t0 } = await send("stake", pool.stake(T(100)), events());

  step("Verify stakedBalance");
  row("stakedBalance(user)", `${fmt(await pool.stakedBalance(account.address))} ${sym}`);
  row(`${sym} wallet balance`, fmt(await stk.balanceOf(account.address)));

  step(`Wait ~${WAIT_SECONDS} s and call earned(user)`);
  await wait(WAIT_SECONDS);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  row("elapsed since stake", `${now - t0} s`);
  row("earned(user)", `${fmt(await pool.earned(account.address))} RWD`);
  row("formula", `100 × 0.001 × ${now - t0} = ${(100 * 0.001 * (now - t0)).toFixed(3)} RWD`);

  step(`Call ${claimFn}() and verify the RWD balance`);
  const { timestamp: t1 } = await send(claimFn, pool[claimFn](), events());
  row("elapsed at mining", `${t1 - t0} s (one extra second per mined block)`);
  row("user RWD balance", fmt(await rwd.balanceOf(account.address)));

  step(`Wait again and call ${withdrawFn}(40)`);
  await wait(WAIT_SECONDS);
  await send(withdrawFn, pool[withdrawFn](T(40)), events());

  step(`Verify ${sym} balance and remaining stakedBalance`);
  row(`${sym} wallet balance`, fmt(await stk.balanceOf(account.address)));
  row("stakedBalance(user)", `${fmt(await pool.stakedBalance(account.address))} ${sym}`);
  row("pendingReward(user)", `${fmt(await pool.pendingReward(account.address))} RWD (preserved, not lost)`);

  step("Call exit() to withdraw the rest and claim pending RWD");
  await wait(WAIT_SECONDS);
  await send("exit", pool.exit(), events());
  row(`${sym} wallet balance`, fmt(await stk.balanceOf(account.address)));
  row("stakedBalance(user)", fmt(await pool.stakedBalance(account.address)));
  row("user RWD balance (total)", fmt(await rwd.balanceOf(account.address)));
  row("pool RWD left", fmt(await rwd.balanceOf(poolAddress)));
}

console.log("\nVaultWise — Experiment 5 lifecycle (yield farming + protocol staking)");
console.log(`Network: ${networkName}  ·  Test account: ${account.address}`);

await runPart({
  title: "PART 1 — YIELD FARMING (LP Token → SimpleYieldFarm)",
  contractName: "SimpleYieldFarm",
  stake: ["LP Token", "LPT"],
  claimFn: "harvest",
  withdrawFn: "withdraw",
});

stepNumber = 0;
await runPart({
  title: "PART 2 — PROTOCOL STAKING (ABC → SimpleStaking)",
  contractName: "SimpleStaking",
  stake: ["Protocol Token", "ABC"],
  claimFn: "claimReward",
  withdrawFn: "unstake",
});

console.log("\nDone.\n");
