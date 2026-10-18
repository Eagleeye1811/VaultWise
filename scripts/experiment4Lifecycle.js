import { network } from "hardhat";

/**
 * VaultWise — Experiment 4 lifecycle demonstration.
 *
 * Walks the 13-step workflow of the experiment in order — deploy, mint,
 * approve, add liquidity, swap both ways, remove liquidity — and prints every
 * reserve, balance, LP-share figure and the constant product `k` after each
 * step, plus the decoded event logs. This is the "console output" evidence the
 * experiment sheet asks for.
 *
 * It deploys its own fresh contracts so every run starts from a known state.
 *
 *   npx hardhat run scripts/experiment4Lifecycle.js                    # local
 *   npx hardhat run scripts/experiment4Lifecycle.js --network sepolia  # Sepolia (costs gas)
 */

const { ethers, networkName } = await network.getOrCreate();

const T = (whole) => ethers.parseUnits(String(whole), 18);
const fmt = (raw) => ethers.formatUnits(raw, 18);

let stepNumber = 0;
const step = (title) => {
  stepNumber += 1;
  console.log(`\n${"─".repeat(72)}`);
  console.log(`STEP ${stepNumber} — ${title}`);
  console.log("─".repeat(72));
};
const row = (label, value) => console.log(`  ${label.padEnd(30)} ${value}`);

const [deployer] = await ethers.getSigners();
const account = deployer; // single test account, as in Remix

console.log("\nVaultWise — Experiment 4 lifecycle (no-fee constant-product AMM)");
console.log(`Network: ${networkName}  ·  Test account: ${account.address}`);

// ===========================================================================
step("Deploy Token A");
// ===========================================================================
const MockERC20 = await ethers.getContractFactory("MockERC20");
const tka = await MockERC20.deploy("Token A", "TKA");
await tka.waitForDeployment();
const tkaAddress = await tka.getAddress();
row("address", tkaAddress);
row("tx hash", tka.deploymentTransaction().hash);

// ===========================================================================
step("Deploy Token B");
// ===========================================================================
const tkb = await MockERC20.deploy("Token B", "TKB");
await tkb.waitForDeployment();
const tkbAddress = await tkb.getAddress();
row("address", tkbAddress);
row("tx hash", tkb.deploymentTransaction().hash);

// ===========================================================================
step("Mint 10 000 TKA and 10 000 TKB to the test account");
// ===========================================================================
for (const [symbol, token] of [
  ["TKA", tka],
  ["TKB", tkb],
]) {
  const tx = await token.mint(account.address, T(10_000));
  await tx.wait();
  row(`${symbol} mint tx`, tx.hash);
  row(`${symbol} balance`, `${fmt(await token.balanceOf(account.address))} ${symbol}`);
}

// ===========================================================================
step("Deploy SimpleAMM(TKA, TKB)");
// ===========================================================================
const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
const amm = await SimpleAMM.deploy(tkaAddress, tkbAddress);
await amm.waitForDeployment();
const ammAddress = await amm.getAddress();
row("address", ammAddress);
row("tx hash", amm.deploymentTransaction().hash);
row("LP token", `${await amm.name()} (${await amm.symbol()})`);

const registry = new Map([
  [tkaAddress.toLowerCase(), { name: "TKA", contract: tka }],
  [tkbAddress.toLowerCase(), { name: "TKB", contract: tkb }],
  [ammAddress.toLowerCase(), { name: "SimpleAMM", contract: amm }],
]);

/** Decode a receipt's logs, attributing each to its emitting contract. */
function printLogs(receipt) {
  console.log("  logs:");
  for (const log of receipt.logs) {
    const source = registry.get(log.address.toLowerCase());
    const parsed = source?.contract.interface.parseLog(log);
    if (!parsed) continue;
    const args = parsed.fragment.inputs
      .map((input, i) => {
        const v = parsed.args[i];
        return `${input.name}=${typeof v === "bigint" ? fmt(v) : v}`;
      })
      .join(", ");
    console.log(`    [${source.name}] ${parsed.name}(${args})`);
  }
}

/** Print the whole pool + account picture. */
async function printState() {
  const [rA, rB] = await amm.getReserves();
  row("reserveA", `${fmt(rA)} TKA`);
  row("reserveB", `${fmt(rB)} TKB`);
  row("k = reserveA * reserveB (raw)", (rA * rB).toString());
  row("price (TKB per TKA)", rA === 0n ? "—" : (Number(fmt(rB)) / Number(fmt(rA))).toFixed(6));
  row("LP totalSupply", `${fmt(await amm.totalSupply())} vwLP`);
  row("account LP balance", `${fmt(await amm.balanceOf(account.address))} vwLP`);
  row("account TKA", fmt(await tka.balanceOf(account.address)));
  row("account TKB", fmt(await tkb.balanceOf(account.address)));
  return rA * rB;
}

// ===========================================================================
step("Approve SimpleAMM for 1 000 TKA and 4 000 TKB");
// ===========================================================================
for (const [symbol, token, amount] of [
  ["TKA", tka, T(1000)],
  ["TKB", tkb, T(4000)],
]) {
  const tx = await token.approve(ammAddress, amount);
  await tx.wait();
  row(`${symbol} approve tx`, tx.hash);
  row(`${symbol} allowance`, fmt(await token.allowance(account.address, ammAddress)));
}

// ===========================================================================
step("addLiquidity(1 000 TKA, 4 000 TKB)");
// ===========================================================================
let tx = await amm.addLiquidity(T(1000), T(4000));
printLogs(await tx.wait());
row("tx hash", tx.hash);

// ===========================================================================
step("Verify reserves and LP-share balance");
// ===========================================================================
let k = await printState();
row("expected LP (sqrt(1000*4000))", "2000.0 vwLP");

// ===========================================================================
step("Quote and execute swapAForB(100 TKA)");
// ===========================================================================
const quoteB = await amm.getAmountOut(tkaAddress, T(100));
row("getAmountOut(TKA, 100)", `${fmt(quoteB)} TKB`);
await (await tka.approve(ammAddress, T(100))).wait();
tx = await amm.swapAForB(T(100));
printLogs(await tx.wait());
row("tx hash", tx.hash);

// ===========================================================================
step("Verify balances and reserves after TKA -> TKB");
// ===========================================================================
let kAfter = await printState();
row("k change (raw, >= 0 expected)", (kAfter - k).toString());
k = kAfter;

// ===========================================================================
step("Quote and execute swapBForA(300 TKB)");
// ===========================================================================
const quoteA = await amm.getAmountOut(tkbAddress, T(300));
row("getAmountOut(TKB, 300)", `${fmt(quoteA)} TKA`);
await (await tkb.approve(ammAddress, T(300))).wait();
tx = await amm.swapBForA(T(300));
printLogs(await tx.wait());
row("tx hash", tx.hash);

// ===========================================================================
step("Verify balances and reserves after TKB -> TKA");
// ===========================================================================
kAfter = await printState();
row("k change (raw, >= 0 expected)", (kAfter - k).toString());

// ===========================================================================
step("removeLiquidity(1 000 vwLP) — half the position");
// ===========================================================================
const lpBefore = await amm.balanceOf(account.address);
row("LP balance before", `${fmt(lpBefore)} vwLP`);
tx = await amm.removeLiquidity(T(1000));
printLogs(await tx.wait());
row("tx hash", tx.hash);

// ===========================================================================
step("Verify returned assets, final reserves and LP balance");
// ===========================================================================
await printState();
row("LP balance change", `${fmt(lpBefore)} -> ${fmt(await amm.balanceOf(account.address))} vwLP`);

const [finalA, finalB] = await amm.getReserves();
const heldA = await tka.balanceOf(ammAddress);
const heldB = await tkb.balanceOf(ammAddress);
row("reserves == pool balances?", heldA === finalA && heldB === finalB ? "yes" : "NO — MISMATCH");

console.log("\nDone.\n");
