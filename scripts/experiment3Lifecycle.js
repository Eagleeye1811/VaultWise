import { network } from "hardhat";

/**
 * VaultWise — Experiment 3 lifecycle demonstration.
 *
 * Walks Steps 1 to 12 of the experiment brief in order and prints every value
 * that the brief asks to be "recorded", including the decoded ERC-20 and
 * ERC-4626 event logs from Step 12.
 *
 * It deploys its own fresh contracts so the numbers always start from a known
 * state and the whole run is reproducible.
 *
 *   npx hardhat run scripts/experiment3Lifecycle.js                   # local
 *   npx hardhat run scripts/experiment3Lifecycle.js --network sepolia # Sepolia (costs gas)
 */

const VAULT_FQN = "contracts/experiment3/VaultWiseVault.sol:VaultWiseVault";

const { ethers, networkName } = await network.getOrCreate();

const usdc6 = (whole) => ethers.parseUnits(String(whole), 6);
const fmt = (raw) => ethers.formatUnits(raw, 6);

let stepNumber = 0;
const step = (title) => {
  stepNumber += 1;
  console.log(`\n${"─".repeat(72)}`);
  console.log(`STEP ${stepNumber} — ${title}`);
  console.log("─".repeat(72));
};
const row = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);

/**
 * Resolve a log to the contract that emitted it.
 *
 * Matching is done on `log.address`, never by trying each ABI in turn: the
 * vault's shares are themselves an ERC-20, so MockUSDC and the vault emit
 * byte-identical `Transfer` signatures and a signature-based match would
 * happily attribute a share mint to MockUSDC.
 */
function sourceOf(log, registry) {
  const address = log.address.toLowerCase();
  return registry.find((entry) => entry.address === address) ?? null;
}

/** Decode and print every log a receipt produced. */
function decodeLogs(receipt, registry) {
  for (const log of receipt.logs) {
    const source = sourceOf(log, registry);
    if (!source) {
      console.log(`  [unknown ${log.address}] (not one of our contracts)`);
      continue;
    }

    const parsed = source.contract.interface.parseLog(log);
    if (!parsed) {
      console.log(`  [${source.name}] (event not in ABI)`);
      continue;
    }

    const args = parsed.fragment.inputs
      .map((input, i) => {
        const value = parsed.args[i];
        const shown = typeof value === "bigint" ? `${value} (${fmt(value)})` : value;
        return `${input.name}=${shown}`;
      })
      .join(", ");
    console.log(`  [${source.name}] ${parsed.name}(${args})`);
  }
}

const [deployer, user] = await ethers.getSigners();
// On a live network there is only one signer, so the "user" is the deployer.
const account = user ?? deployer;

console.log("\nVaultWise — Experiment 3 lifecycle (ERC-20 + ERC-4626)");
console.log(`Network: ${networkName}  ·  Test wallet: ${account.address}`);

// ===========================================================================
step("Deploy MockUSDC");
// ===========================================================================
const MockUSDC = await ethers.getContractFactory("MockUSDC");
const usdc = await MockUSDC.deploy();
await usdc.waitForDeployment();
const usdcAddress = await usdc.getAddress();

row("contract address", usdcAddress);
row("transaction hash", usdc.deploymentTransaction().hash);
row("name / symbol", `${await usdc.name()} / ${await usdc.symbol()}`);
row("decimals", await usdc.decimals());

// ===========================================================================
step("Mint 1000 USDC to the test wallet");
// ===========================================================================
const mintTx = await usdc.mint(account.address, usdc6(1000));
const mintReceipt = await mintTx.wait();

row("transaction hash", mintTx.hash);
row("balanceOf(user)", `${fmt(await usdc.balanceOf(account.address))} USDC`);
row("raw base units", await usdc.balanceOf(account.address));
row("totalSupply()", `${fmt(await usdc.totalSupply())} USDC`);
console.log("  logs:");
decodeLogs(mintReceipt, [{ name: "MockUSDC", address: usdcAddress.toLowerCase(), contract: usdc }]);

// ===========================================================================
step("Deploy VaultWiseVault(MockUSDC)");
// ===========================================================================
const VaultWiseVault = await ethers.getContractFactory(VAULT_FQN);
const vault = await VaultWiseVault.deploy(usdcAddress);
await vault.waitForDeployment();
const vaultAddress = await vault.getAddress();

row("vault address", vaultAddress);
row("transaction hash", vault.deploymentTransaction().hash);
row("share name / symbol", `${await vault.name()} / ${await vault.symbol()}`);
row("share decimals", await vault.decimals());

/** Address -> contract map used to attribute every log to its real emitter. */
const contractRegistry = [
  { name: "MockUSDC", address: usdcAddress.toLowerCase(), contract: usdc },
  { name: "VaultWiseVault", address: vaultAddress.toLowerCase(), contract: vault },
];

const profile = await vault.vaultProfile();
console.log("\n  VaultWise vault profile (application-specific feature):");
row("  label", profile.label);
row("  category", profile.category);
row("  experiment", profile.experiment);
row("  asset / share symbol", `${profile.assetSymbol} -> ${profile.shareSymbol}`);
row("  risk note", profile.riskNote);

// ===========================================================================
step("asset() and totalAssets() before any deposit");
// ===========================================================================
row("asset()", await vault.asset());
row("matches MockUSDC?", (await vault.asset()) === usdcAddress ? "yes" : "NO — MISWIRED");
row("totalAssets()", await vault.totalAssets());
row("totalSupply()", await vault.totalSupply());

// ===========================================================================
step("approve(vault, 100 USDC) and check the allowance");
// ===========================================================================
const approveTx = await usdc.connect(account).approve(vaultAddress, usdc6(100));
const approveReceipt = await approveTx.wait();

row("transaction hash", approveTx.hash);
row("allowance(user, vault)", `${fmt(await usdc.allowance(account.address, vaultAddress))} USDC`);
console.log("  logs:");
decodeLogs(approveReceipt, contractRegistry);

// ===========================================================================
step("previewDeposit(100 USDC) and convertToShares(100 USDC)");
// ===========================================================================
row("previewDeposit(100 USDC)", `${fmt(await vault.previewDeposit(usdc6(100)))} vwUSDC`);
row("convertToShares(100 USDC)", `${fmt(await vault.convertToShares(usdc6(100)))} vwUSDC`);
row("expected shares", `${fmt(await vault.previewDeposit(usdc6(100)))} vwUSDC`);

// ===========================================================================
step("deposit(100 USDC, user)");
// ===========================================================================
const depositTx = await vault.connect(account).deposit(usdc6(100), account.address);
const depositReceipt = await depositTx.wait();

row("transaction hash", depositTx.hash);
row("user USDC balance", `${fmt(await usdc.balanceOf(account.address))} USDC  (was 1000)`);
row("user vault shares", `${fmt(await vault.balanceOf(account.address))} vwUSDC (was 0)`);
row("vault totalAssets()", `${fmt(await vault.totalAssets())} USDC  (was 0)`);
row("vault totalSupply()", `${fmt(await vault.totalSupply())} vwUSDC (was 0)`);
console.log("  logs:");
decodeLogs(depositReceipt, contractRegistry);

// ===========================================================================
step("convertToShares() / convertToAssets() with meaningful values");
// ===========================================================================
for (const amount of [1, 25, 100, 250]) {
  row(`convertToShares(${amount} USDC)`, `${fmt(await vault.convertToShares(usdc6(amount)))} vwUSDC`);
}
for (const amount of [1, 25, 100, 250]) {
  row(`convertToAssets(${amount} vwUSDC)`, `${fmt(await vault.convertToAssets(usdc6(amount)))} USDC`);
}

// ===========================================================================
step("mint(50 vwUSDC) — ask for shares, observe the assets required");
// ===========================================================================
const mintCost = await vault.previewMint(usdc6(50));
row("previewMint(50 vwUSDC)", `${fmt(mintCost)} USDC required`);

await (await usdc.connect(account).approve(vaultAddress, mintCost)).wait();
const mintSharesTx = await vault.connect(account).mint(usdc6(50), account.address);
const mintSharesReceipt = await mintSharesTx.wait();

row("transaction hash", mintSharesTx.hash);
row("user USDC balance", `${fmt(await usdc.balanceOf(account.address))} USDC`);
row("user vault shares", `${fmt(await vault.balanceOf(account.address))} vwUSDC`);
row("vault totalAssets()", `${fmt(await vault.totalAssets())} USDC`);
console.log("  logs:");
decodeLogs(mintSharesReceipt, contractRegistry);

// ===========================================================================
step("withdraw(30 USDC) — ask for assets, observe the shares burned");
// ===========================================================================
const sharesBeforeWithdraw = await vault.balanceOf(account.address);
row("previewWithdraw(30 USDC)", `${fmt(await vault.previewWithdraw(usdc6(30)))} vwUSDC will burn`);

const withdrawTx = await vault
  .connect(account)
  .withdraw(usdc6(30), account.address, account.address);
const withdrawReceipt = await withdrawTx.wait();

row("transaction hash", withdrawTx.hash);
row("shares burned", `${fmt(sharesBeforeWithdraw - (await vault.balanceOf(account.address)))} vwUSDC`);
row("user USDC balance", `${fmt(await usdc.balanceOf(account.address))} USDC`);
row("user vault shares", `${fmt(await vault.balanceOf(account.address))} vwUSDC`);
row("vault totalAssets()", `${fmt(await vault.totalAssets())} USDC`);
console.log("  logs:");
decodeLogs(withdrawReceipt, contractRegistry);

// ===========================================================================
step("redeem(20 vwUSDC) — burn shares, observe the assets returned");
// ===========================================================================
const usdcBeforeRedeem = await usdc.balanceOf(account.address);
row("previewRedeem(20 vwUSDC)", `${fmt(await vault.previewRedeem(usdc6(20)))} USDC will return`);

const redeemTx = await vault
  .connect(account)
  .redeem(usdc6(20), account.address, account.address);
const redeemReceipt = await redeemTx.wait();

row("transaction hash", redeemTx.hash);
row("USDC returned", `${fmt((await usdc.balanceOf(account.address)) - usdcBeforeRedeem)} USDC`);
row("user vault shares", `${fmt(await vault.balanceOf(account.address))} vwUSDC`);
row("vault totalAssets()", `${fmt(await vault.totalAssets())} USDC`);
row("vault totalSupply()", `${fmt(await vault.totalSupply())} vwUSDC`);
console.log("  logs:");
decodeLogs(redeemReceipt, contractRegistry);

// ===========================================================================
step("Event summary — which standard emitted what");
// ===========================================================================
const receipts = {
  "approve()": approveReceipt,
  "deposit()": depositReceipt,
  "mint()": mintSharesReceipt,
  "withdraw()": withdrawReceipt,
  "redeem()": redeemReceipt,
};
const ERC4626_EVENTS = new Set(["Deposit", "Withdraw"]);

for (const [call, receipt] of Object.entries(receipts)) {
  const names = receipt.logs.map((log) => {
    const source = sourceOf(log, contractRegistry);
    if (!source) return `unknown(${log.address})`;
    const parsed = source.contract.interface.parseLog(log);
    if (!parsed) return `${source.name}.<unparsed>`;
    const standard = ERC4626_EVENTS.has(parsed.name) ? "ERC-4626" : "ERC-20";
    return `${source.name}.${parsed.name} [${standard}]`;
  });
  row(call, names.join(", ") || "no logs");
}

// ===========================================================================
console.log(`\n${"═".repeat(72)}`);
console.log("Final state");
console.log("═".repeat(72));
row("MockUSDC", usdcAddress);
row("VaultWiseVault (ERC-4626)", vaultAddress);
row("user USDC", `${fmt(await usdc.balanceOf(account.address))} USDC`);
row("user shares", `${fmt(await vault.balanceOf(account.address))} vwUSDC`);
row("user claim on assets", `${fmt(await vault.maxWithdraw(account.address))} USDC`);
row("vault totalAssets()", `${fmt(await vault.totalAssets())} USDC`);
row("vault totalSupply()", `${fmt(await vault.totalSupply())} vwUSDC`);
console.log("");
