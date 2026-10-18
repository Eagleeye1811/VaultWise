import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

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
 * The record goes to deployments/<network>-experiment6.json; an existing
 * record is never overwritten (a timestamped file is written instead).
 */

const MINT_WHOLE_TOKENS = 10_000n;
const TOTAL_STEPS = 6;

const { ethers, networkName } = await network.getOrCreate();

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
const chainId = (await ethers.provider.getNetwork()).chainId;

console.log("\nVaultWise — Experiment 6 deployment (DEX prototype)");
console.log("===================================================");
console.log(`Network   : ${networkName} (chain id ${chainId})`);
console.log(`Deployer  : ${deployer.address}`);
console.log(`Gas funds : ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  throw new Error(`Deployer ${deployer.address} has no ETH on ${networkName}. Fund it from a Sepolia faucet first.`);
}

let stepNumber = 0;
const step = (title) => console.log(`\n[${(stepNumber += 1)}/${TOTAL_STEPS}] ${title}`);

/** Deploy and print address + tx hash. */
async function deploy(contractName, args, label) {
  step(`Deploying ${label} ...`);
  const contract = await (await ethers.getContractFactory(contractName)).deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction().hash;
  console.log(`      address : ${address}`);
  console.log(`      tx hash : ${txHash}`);
  return { contract, address, txHash };
}

const tokens = {};
for (const [key, name, symbol] of [
  ["A", "Token A", "DXA"],
  ["B", "Token B", "DXB"],
  ["C", "Token C", "DXC"],
]) {
  tokens[key] = { ...(await deploy("DexMockERC20", [name, symbol], `DexMockERC20("${name}", "${symbol}")`)), name, symbol };
}
const factory = await deploy("Factory", [], "Factory");
const router = await deploy("Router", [factory.address], `Router(${factory.address})`);

step(`Minting ${MINT_WHOLE_TOKENS} of each token to the deployer ...`);
const amount = ethers.parseUnits(MINT_WHOLE_TOKENS.toString(), 18);
const mintTxs = {};
for (const { contract, symbol } of Object.values(tokens)) {
  const before = await contract.balanceOf(deployer.address);
  const tx = await contract.mint(deployer.address, amount);
  await tx.wait();
  const after = await contract.balanceOf(deployer.address);
  if (after - before !== amount) throw new Error(`${symbol} mint verification failed`);
  mintTxs[symbol] = tx.hash;
  console.log(`      ${symbol} tx : ${tx.hash}  -> ${ethers.formatUnits(after, 18)} ${symbol}`);
}

// Refuse to report success on a bad wiring.
const wiredFactory = await router.contract.factory();
const pairs = await factory.contract.allPairsLength();
if (wiredFactory !== factory.address) throw new Error(`Router.factory() is ${wiredFactory}, expected ${factory.address}`);
if (pairs !== 0n) throw new Error(`fresh Factory reports ${pairs} pairs`);
console.log("\nVerification");
console.log(`  Router.factory()         : ${wiredFactory}  (matches Factory)`);
console.log(`  Factory.allPairsLength() : ${pairs}  (no pairs yet, as expected)`);
console.log(`  Router.getAmountOut(100, 1000, 2000) : ${await router.contract.getAmountOut(100n, 1000n, 2000n)}  (sheet: 181)`);

const record = {
  experiment: 6,
  network: networkName,
  chainId: Number(chainId),
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  contracts: {
    TokenA: { address: tokens.A.address, txHash: tokens.A.txHash, name: "Token A", symbol: "DXA" },
    TokenB: { address: tokens.B.address, txHash: tokens.B.txHash, name: "Token B", symbol: "DXB" },
    TokenC: { address: tokens.C.address, txHash: tokens.C.txHash, name: "Token C", symbol: "DXC" },
    Factory: { address: factory.address, txHash: factory.txHash },
    Router: { address: router.address, txHash: router.txHash, factory: factory.address },
  },
  mint: { to: deployer.address, wholeTokensEach: MINT_WHOLE_TOKENS.toString(), txHashes: mintTxs },
};

mkdirSync("deployments", { recursive: true });
let recordPath = `deployments/${networkName}-experiment6.json`;
if (existsSync(recordPath) && networkName !== "default") {
  recordPath = `deployments/${networkName}-experiment6-${Date.now()}.json`;
  console.log(`\nAn earlier Experiment 6 record exists; keeping it and writing ${recordPath} instead.`);
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
console.log(`VITE_DEX_FACTORY_ADDRESS=${factory.address}`);
console.log(`VITE_DEX_ROUTER_ADDRESS=${router.address}`);
console.log(`VITE_DEX_TOKEN_A_ADDRESS=${tokens.A.address}`);
console.log(`VITE_DEX_TOKEN_B_ADDRESS=${tokens.B.address}`);
console.log(`VITE_DEX_TOKEN_C_ADDRESS=${tokens.C.address}`);
console.log("------------------------------------------------------------\n");
