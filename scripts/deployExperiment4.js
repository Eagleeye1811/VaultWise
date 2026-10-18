import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 4 deployment script (AMM liquidity pool).
 *
 * Deploys, in the order the experiment sheet requires:
 *
 *   1. MockERC20("Token A", "TKA")
 *   2. MockERC20("Token B", "TKB")
 *   3. mint 10 000 TKA and 10 000 TKB to the deployer (test balances)
 *   4. SimpleAMM(TKA, TKB)
 *
 * and then checks the wiring before reporting success. It does NOT add
 * liquidity or swap — those are the experiment itself, done in Remix or the UI.
 *
 * The existing Experiment 1 and Experiment 3 contracts are not touched.
 *
 * Usage
 * -----
 *   npx hardhat run scripts/deployExperiment4.js                     # local
 *   npx hardhat run scripts/deployExperiment4.js --network sepolia   # Sepolia (costs gas)
 *
 * Sepolia secrets live in Hardhat's encrypted keystore, never in this repo:
 *
 *   npx hardhat keystore set SEPOLIA_RPC_URL
 *   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
 */

const MINT_WHOLE_TOKENS = 10_000n;

const { ethers, networkName } = await network.getOrCreate();

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
const chainId = (await ethers.provider.getNetwork()).chainId;

console.log("\nVaultWise — Experiment 4 deployment (AMM liquidity pool)");
console.log("========================================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(
    `Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet before deploying.`
  );
}

const MockERC20 = await ethers.getContractFactory("MockERC20");

/** Deploy one MockERC20 and print its details. */
async function deployToken(step, name, symbol) {
  console.log(`\n[${step}/4] Deploying MockERC20("${name}", "${symbol}") ...`);
  const token = await MockERC20.deploy(name, symbol);
  await token.waitForDeployment();
  const address = await token.getAddress();
  const txHash = token.deploymentTransaction().hash;
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
  console.log(`      decimals: ${await token.decimals()}`);
  return { token, address, txHash };
}

const tka = await deployToken(1, "Token A", "TKA");
const tkb = await deployToken(2, "Token B", "TKB");

// ---------------------------------------------------------------------------
// Step 3 — mint test balances
// ---------------------------------------------------------------------------
console.log(`\n[3/4] Minting ${MINT_WHOLE_TOKENS} TKA and ${MINT_WHOLE_TOKENS} TKB to the deployer ...`);
const mintAmount = ethers.parseUnits(MINT_WHOLE_TOKENS.toString(), 18);
const mintTxs = {};
for (const [symbol, { token }] of [
  ["TKA", tka],
  ["TKB", tkb],
]) {
  const tx = await token.mint(deployer.address, mintAmount);
  await tx.wait();
  const held = await token.balanceOf(deployer.address);
  if (held !== mintAmount) throw new Error(`${symbol} mint verification failed: got ${held}`);
  mintTxs[symbol] = tx.hash;
  console.log(`      ${symbol} tx : ${tx.hash}  -> ${ethers.formatUnits(held, 18)} ${symbol}`);
}

// ---------------------------------------------------------------------------
// Step 4 — the pool
// ---------------------------------------------------------------------------
console.log("\n[4/4] Deploying SimpleAMM(TKA, TKB) ...");
const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
const amm = await SimpleAMM.deploy(tka.address, tkb.address);
await amm.waitForDeployment();
const ammAddress = await amm.getAddress();
const ammTxHash = amm.deploymentTransaction().hash;
console.log(`      address : ${ammAddress}`);
console.log(`      tx hash : ${ammTxHash}`);
console.log(`      LP token: ${await amm.name()} (${await amm.symbol()})`);

// ---------------------------------------------------------------------------
// Verification — refuse to report success on a bad wiring
// ---------------------------------------------------------------------------
const wiredA = await amm.tokenA();
const wiredB = await amm.tokenB();
const [reserveA, reserveB] = await amm.getReserves();
const supply = await amm.totalSupply();

if (wiredA !== tka.address) throw new Error(`tokenA() is ${wiredA}, expected ${tka.address}`);
if (wiredB !== tkb.address) throw new Error(`tokenB() is ${wiredB}, expected ${tkb.address}`);
if (reserveA !== 0n || reserveB !== 0n || supply !== 0n) {
  throw new Error(`Fresh pool is not empty: reserves=${reserveA}/${reserveB}, supply=${supply}`);
}

console.log("\nVerification");
console.log(`  tokenA()      : ${wiredA}  (matches TKA)`);
console.log(`  tokenB()      : ${wiredB}  (matches TKB)`);
console.log(`  getReserves() : ${reserveA}, ${reserveB}  (empty, as expected)`);
console.log(`  totalSupply() : ${supply}  (no LP shares yet)`);

// ---------------------------------------------------------------------------
// Record + frontend configuration
// ---------------------------------------------------------------------------
const record = {
  experiment: 4,
  network: networkName,
  chainId: Number(chainId),
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  contracts: {
    TokenA: { address: tka.address, txHash: tka.txHash, name: "Token A", symbol: "TKA" },
    TokenB: { address: tkb.address, txHash: tkb.txHash, name: "Token B", symbol: "TKB" },
    SimpleAMM: { address: ammAddress, txHash: ammTxHash, tokenA: tka.address, tokenB: tkb.address },
  },
  mint: { to: deployer.address, wholeTokensEach: MINT_WHOLE_TOKENS.toString(), txHashes: mintTxs },
};

mkdirSync("deployments", { recursive: true });
// A separate file so the Experiment 3 record (deployments/<network>.json) is never overwritten.
const recordPath = `deployments/${networkName}-experiment4.json`;
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(`\nDeployment record written to ${recordPath}`);
console.log("\nAdd these to frontend/.env.local, then restart `npm run dev`:");
console.log("------------------------------------------------------------");
console.log(`VITE_TOKEN_A_ADDRESS=${tka.address}`);
console.log(`VITE_TOKEN_B_ADDRESS=${tkb.address}`);
console.log(`VITE_AMM_ADDRESS=${ammAddress}`);
console.log("------------------------------------------------------------\n");
