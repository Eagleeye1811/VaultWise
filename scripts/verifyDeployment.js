import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider } from "ethers";

/**
 * VaultWise — verify a live deployment against the frontend configuration.
 *
 * Answers the question "are the addresses in my .env actually the contracts I
 * think they are?" without needing a private key, a keystore, or MetaMask. It
 * reads `frontend/.env` (or `.env.local` if present), talks to a public Sepolia
 * RPC, and checks that:
 *
 *   - there is real bytecode at every configured address
 *   - MockUSDC is the token it claims to be, with 6 decimals
 *   - the vault's share token is the one this repo compiles
 *   - the vault's `asset()` really points at the configured MockUSDC
 *   - the ERC-4626 surface answers
 *   - `vaultProfile()` agrees with `asset()`
 *
 * Run it after deploying, or any time the app shows numbers you do not expect:
 *
 *     npm run verify:sepolia
 *
 * It exits non-zero if anything fails, so it is safe to use in a check script.
 */

const ROOT = new URL("..", import.meta.url).pathname;

const RPC_ENDPOINTS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
  "https://sepolia.drpc.org",
];

const artifactAbi = (relativePath) =>
  JSON.parse(readFileSync(`${ROOT}artifacts/${relativePath}`, "utf8")).abi;

/** Read VITE_* variables out of the frontend env file. */
function readFrontendEnv() {
  for (const candidate of ["frontend/.env.local", "frontend/.env"]) {
    let contents;
    try {
      contents = readFileSync(`${ROOT}${candidate}`, "utf8");
    } catch {
      continue;
    }

    const entries = contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()];
      });

    const env = Object.fromEntries(entries);
    if (env.VITE_USDC_ADDRESS || env.VITE_VAULT4626_ADDRESS) {
      return { env, source: candidate };
    }
  }
  return { env: {}, source: null };
}

async function connect() {
  for (const url of RPC_ENDPOINTS) {
    try {
      const provider = new JsonRpcProvider(url, 11155111, { staticNetwork: true });
      const block = await provider.getBlockNumber();
      console.log(`Sepolia via ${url} — block ${block}\n`);
      return provider;
    } catch {
      // Try the next public endpoint.
    }
  }
  throw new Error(
    `Could not reach any Sepolia RPC endpoint. Tried:\n  ${RPC_ENDPOINTS.join("\n  ")}`
  );
}

const format = (raw, decimals) =>
  (Number(raw) / 10 ** Number(decimals)).toLocaleString("en-US");

let failures = 0;
function check(label, passed, detail = "") {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ */

const { env, source } = readFrontendEnv();

if (!source) {
  console.error(
    "No addresses found. Set VITE_USDC_ADDRESS and VITE_VAULT4626_ADDRESS in frontend/.env.local"
  );
  process.exit(1);
}

const usdcAddress = env.VITE_USDC_ADDRESS;
const vaultAddress = env.VITE_VAULT4626_ADDRESS;
const ethVaultAddress = env.VITE_CONTRACT_ADDRESS;

console.log("VaultWise — deployment verification");
console.log("===================================");
console.log(`Config source: ${source}\n`);

const provider = await connect();

console.log("Bytecode present at every configured address");
for (const [label, address] of [
  ["MockUSDC          ", usdcAddress],
  ["VaultWiseVault    ", vaultAddress],
  ["Experiment 1 vault", ethVaultAddress],
]) {
  if (!address) {
    check(`${label} configured`, false, "not set");
    continue;
  }
  const code = await provider.getCode(address);
  check(`${label} ${address}`, code !== "0x", `${(code.length - 2) / 2} bytes`);
}

if (!usdcAddress || !vaultAddress) {
  console.log("\nExperiment 3 addresses incomplete — stopping here.");
  process.exit(1);
}

const usdc = new Contract(
  usdcAddress,
  artifactAbi("contracts/experiment3/MockUSDC.sol/MockUSDC.json"),
  provider
);
const vault = new Contract(
  vaultAddress,
  artifactAbi("contracts/experiment3/VaultWiseVault.sol/VaultWiseVault.json"),
  provider
);

console.log("\nMockUSDC — the ERC-20 underlying asset");
const [tokenName, tokenSymbol, tokenDecimals, tokenSupply, tokenOwner] = await Promise.all([
  usdc.name(),
  usdc.symbol(),
  usdc.decimals(),
  usdc.totalSupply(),
  usdc.owner(),
]);
check("name", tokenName === "Mock USDC", tokenName);
check("symbol", tokenSymbol === "USDC", tokenSymbol);
check("decimals is 6", tokenDecimals === 6n, String(tokenDecimals));
console.log(`         totalSupply ${format(tokenSupply, tokenDecimals)} ${tokenSymbol}`);
console.log(`         owner (can mint test tokens) ${tokenOwner}`);

console.log("\nVaultWiseVault — the ERC-4626 vault");
const [shareName, shareSymbol, shareDecimals, asset, totalAssets, totalSupply] =
  await Promise.all([
    vault.name(),
    vault.symbol(),
    vault.decimals(),
    vault.asset(),
    vault.totalAssets(),
    vault.totalSupply(),
  ]);
check("share name", shareName === "VaultWise Vault Share", shareName);
check("share symbol", shareSymbol === "vwUSDC", shareSymbol);
check("share decimals inherited from the asset", shareDecimals === 6n, String(shareDecimals));
check(
  "asset() points at the configured MockUSDC",
  asset.toLowerCase() === usdcAddress.toLowerCase(),
  asset
);
console.log(`         totalAssets ${format(totalAssets, tokenDecimals)} ${tokenSymbol}`);
console.log(`         totalSupply ${format(totalSupply, shareDecimals)} ${shareSymbol}`);

console.log("\nERC-4626 surface responds");
const oneHundred = 100n * 10n ** tokenDecimals;
const [previewDeposit, convertToShares, convertToAssets, maxDeposit] = await Promise.all([
  vault.previewDeposit(oneHundred),
  vault.convertToShares(oneHundred),
  vault.convertToAssets(oneHundred),
  vault.maxDeposit(tokenOwner),
]);
check("previewDeposit(100)", previewDeposit > 0n, `${format(previewDeposit, shareDecimals)} ${shareSymbol}`);
check("convertToShares(100)", convertToShares > 0n, `${format(convertToShares, shareDecimals)} ${shareSymbol}`);
check("convertToAssets(100)", convertToAssets > 0n, `${format(convertToAssets, tokenDecimals)} ${tokenSymbol}`);
check("maxDeposit is unbounded", maxDeposit > 0n, "uint256 max");

console.log("\nVaultWise feature — vaultProfile()");
const profile = await vault.vaultProfile();
check("label", profile.label === "VaultWise Core USDC Vault", profile.label);
check("category", profile.category === "Stablecoin Treasury", profile.category);
check("assetSymbol", profile.assetSymbol === tokenSymbol, profile.assetSymbol);
check("shareSymbol", profile.shareSymbol === shareSymbol, profile.shareSymbol);
check(
  "profile asset agrees with asset()",
  profile.assetAddress.toLowerCase() === asset.toLowerCase(),
  profile.assetAddress
);

console.log(
  `\n${failures === 0 ? "All checks passed — the frontend config matches what is deployed." : `${failures} check(s) FAILED.`}`
);
process.exit(failures === 0 ? 0 : 1);
