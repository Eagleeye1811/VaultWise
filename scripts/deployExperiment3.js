import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 3 deployment script.
 *
 * Deploys, in the order the experiment requires:
 *
 *   1. MockUSDC                        (the ERC-20 underlying asset)
 *   2. mint 1000 USDC to the deployer  (test balance)
 *   3. VaultWiseVault(MockUSDC)        (the ERC-4626 tokenized vault)
 *
 * and then sanity-checks the wiring before reporting success, so this script
 * cannot print "deployed" for a vault that is pointed at the wrong asset.
 *
 * Usage
 * -----
 *   npx hardhat run scripts/deployExperiment3.js                     # local
 *   npx hardhat run scripts/deployExperiment3.js --network sepolia   # Sepolia
 *
 * Sepolia needs two secrets, stored in Hardhat's encrypted keystore (never in
 * this repository):
 *
 *   npx hardhat keystore set SEPOLIA_RPC_URL
 *   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
 */

const MINT_AMOUNT_USDC = 1000n;
const VAULT_FQN = "contracts/experiment3/VaultWiseVault.sol:VaultWiseVault";

const { ethers, networkName } = await network.getOrCreate();

const usdcUnits = (whole) => whole * 10n ** 6n;
const fmtUsdc = (raw) => ethers.formatUnits(raw, 6);

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
const chainId = (await ethers.provider.getNetwork()).chainId;

console.log("\nVaultWise — Experiment 3 deployment");
console.log("===================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(
    `Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet before deploying.`
  );
}

// ---------------------------------------------------------------------------
// Step 1 — deploy MockUSDC
// ---------------------------------------------------------------------------
console.log("\n[1/3] Deploying MockUSDC ...");
const MockUSDC = await ethers.getContractFactory("MockUSDC");
const usdc = await MockUSDC.deploy();
await usdc.waitForDeployment();

const usdcAddress = await usdc.getAddress();
const usdcDeployTx = usdc.deploymentTransaction().hash;
console.log(`      address : ${usdcAddress}`);
console.log(`      tx hash : ${usdcDeployTx}`);
console.log(
  `      token   : ${await usdc.name()} (${await usdc.symbol()}), ${await usdc.decimals()} decimals`
);

// ---------------------------------------------------------------------------
// Step 2 — mint a known test balance
// ---------------------------------------------------------------------------
console.log(`\n[2/3] Minting ${MINT_AMOUNT_USDC} USDC to the deployer ...`);
const mintTx = await usdc.mint(deployer.address, usdcUnits(MINT_AMOUNT_USDC));
await mintTx.wait();

const minted = await usdc.balanceOf(deployer.address);
console.log(`      tx hash : ${mintTx.hash}`);
console.log(`      balance : ${fmtUsdc(minted)} USDC (${minted} base units)`);

if (minted !== usdcUnits(MINT_AMOUNT_USDC)) {
  throw new Error(`Mint verification failed: expected ${usdcUnits(MINT_AMOUNT_USDC)}, got ${minted}`);
}

// ---------------------------------------------------------------------------
// Step 3 — deploy the ERC-4626 vault on top of MockUSDC
// ---------------------------------------------------------------------------
console.log("\n[3/3] Deploying VaultWiseVault(MockUSDC) ...");
const VaultWiseVault = await ethers.getContractFactory(VAULT_FQN);
const vault = await VaultWiseVault.deploy(usdcAddress);
await vault.waitForDeployment();

const vaultAddress = await vault.getAddress();
const vaultDeployTx = vault.deploymentTransaction().hash;
console.log(`      address : ${vaultAddress}`);
console.log(`      tx hash : ${vaultDeployTx}`);
console.log(
  `      shares  : ${await vault.name()} (${await vault.symbol()}), ${await vault.decimals()} decimals`
);

// ---------------------------------------------------------------------------
// Post-deployment verification — refuse to report success on a bad wiring
// ---------------------------------------------------------------------------
const wiredAsset = await vault.asset();
const initialAssets = await vault.totalAssets();
const initialSupply = await vault.totalSupply();

if (wiredAsset.toLowerCase() !== usdcAddress.toLowerCase()) {
  throw new Error(`Vault asset() is ${wiredAsset} but MockUSDC is ${usdcAddress}`);
}
if (initialAssets !== 0n || initialSupply !== 0n) {
  throw new Error(
    `Fresh vault is not empty: totalAssets=${initialAssets}, totalSupply=${initialSupply}`
  );
}

console.log("\nVerification");
console.log(`  asset()      : ${wiredAsset}  (matches MockUSDC)`);
console.log(`  totalAssets(): ${initialAssets}  (empty, as expected)`);
console.log(`  totalSupply(): ${initialSupply}  (no shares issued yet)`);

const profile = await vault.vaultProfile();
console.log(`  profile      : ${profile.label} — ${profile.category}`);

// ---------------------------------------------------------------------------
// Record the deployment and print the frontend configuration
// ---------------------------------------------------------------------------
const record = {
  network: networkName,
  chainId: Number(chainId),
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  contracts: {
    MockUSDC: { address: usdcAddress, txHash: usdcDeployTx },
    VaultWiseVault: { address: vaultAddress, txHash: vaultDeployTx, asset: usdcAddress },
  },
  mint: { to: deployer.address, amountUsdc: MINT_AMOUNT_USDC.toString(), txHash: mintTx.hash },
};

mkdirSync("deployments", { recursive: true });
const recordPath = `deployments/${networkName}.json`;
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(`\nDeployment record written to ${recordPath}`);
console.log("\nPaste these into frontend/.env.local, then restart `npm run dev`:");
console.log("------------------------------------------------------------");
console.log(`VITE_USDC_ADDRESS=${usdcAddress}`);
console.log(`VITE_VAULT4626_ADDRESS=${vaultAddress}`);
console.log("------------------------------------------------------------\n");
