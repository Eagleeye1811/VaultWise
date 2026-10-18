import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";

/**
 * VaultWise — Experiment 4 live diagnosis (READ-ONLY, no key, no gas).
 *
 * Checks the configured Sepolia AMM deployment against this repository and,
 * optionally, explains exactly why a given wallet's swap would succeed or
 * revert — without sending anything.
 *
 *   npm run verify:exp4                                  # deployment only
 *   npm run verify:exp4 -- 0xYourWallet                  # + wallet state
 *   npm run verify:exp4 -- 0xYourWallet 1 AtoB           # + simulate swapAForB(1 TKA)
 *   npm run verify:exp4 -- 0xYourWallet 2.5 BtoA         # + simulate swapBForA(2.5 TKB)
 *
 * Addresses come from frontend/.env.local or frontend/.env
 * (VITE_TOKEN_A_ADDRESS, VITE_TOKEN_B_ADDRESS, VITE_AMM_ADDRESS).
 * Set SEPOLIA_RPC_URL in the environment to use your own endpoint; otherwise
 * public endpoints are tried in turn.
 *
 * What it checks:
 *   - chain id is Sepolia (11155111)
 *   - bytecode exists at all three addresses and matches this repo's compiled
 *     MockERC20 / SimpleAMM (ignoring compiler metadata and the two immutables)
 *   - the pool's tokenA()/tokenB() are the configured tokens, 18 decimals each
 *   - reserves equal the pool's actual token balances
 *   - for a wallet: balances, allowances, LP shares, EIP-7702 delegation, and
 *     an eth_call simulation of the swap *from that wallet*, decoded
 *
 * Exits non-zero if any deployment check fails.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const SEPOLIA = 11155111n;

const RPC_ENDPOINTS = [
  process.env.SEPOLIA_RPC_URL,
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc.sepolia.org",
].filter(Boolean);

const artifact = (path) => JSON.parse(readFileSync(`${ROOT}artifacts/contracts/experiment4/${path}`, "utf8"));

function readFrontendEnv() {
  for (const candidate of ["frontend/.env.local", "frontend/.env"]) {
    let contents;
    try {
      contents = readFileSync(`${ROOT}${candidate}`, "utf8");
    } catch {
      continue;
    }
    const env = Object.fromEntries(
      contents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
    );
    if (env.VITE_AMM_ADDRESS) return { env, source: candidate };
  }
  return { env: {}, source: null };
}

async function connect() {
  for (const url of RPC_ENDPOINTS) {
    try {
      const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
      await provider.getBlockNumber();
      return { provider, url: url === process.env.SEPOLIA_RPC_URL ? "SEPOLIA_RPC_URL" : url };
    } catch {
      // try the next endpoint
    }
  }
  throw new Error("Could not reach any Sepolia RPC endpoint.");
}

/** Remove the trailing CBOR metadata, whose length is the last two bytes. */
function stripMetadata(hex) {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const length = parseInt(body.slice(-4), 16);
  return body.slice(0, body.length - (length + 2) * 2);
}

/** Zero out immutable slots so on-chain and compiled runtime code compare equal. */
function zeroImmutables(hex, immutableReferences = {}) {
  let body = hex.startsWith("0x") ? hex.slice(2) : hex;
  for (const refs of Object.values(immutableReferences)) {
    for (const { start, length } of refs) {
      body = body.slice(0, start * 2) + "0".repeat(length * 2) + body.slice((start + length) * 2);
    }
  }
  return `0x${body}`;
}

let failures = 0;
const check = (label, passed, detail = "") => {
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
};
const row = (label, value) => console.log(`  ${label.padEnd(30)} ${value}`);
const fmt = (raw) => formatUnits(raw, 18);

/* ------------------------------------------------------------------ */

const [walletArg, amountArg, directionArg = "AtoB"] = process.argv.slice(2);
const { env, source } = readFrontendEnv();
if (!source) {
  console.error("Set VITE_TOKEN_A_ADDRESS, VITE_TOKEN_B_ADDRESS and VITE_AMM_ADDRESS in frontend/.env first.");
  process.exit(1);
}
const TOKEN_A = env.VITE_TOKEN_A_ADDRESS;
const TOKEN_B = env.VITE_TOKEN_B_ADDRESS;
const AMM = env.VITE_AMM_ADDRESS;

console.log("\nVaultWise — Experiment 4 live diagnosis (read-only)");
console.log("===================================================");
console.log(`Config: ${source}`);

const { provider, url } = await connect();
const { chainId } = await provider.getNetwork();
const block = await provider.getBlockNumber();
console.log(`RPC:    ${url} — block ${block}\n`);

console.log("Network");
check("chain id is Sepolia (11155111)", chainId === SEPOLIA, `got ${chainId}`);

console.log("\nBytecode");
const erc20Art = artifact("MockERC20.sol/MockERC20.json");
const ammArt = artifact("SimpleAMM.sol/SimpleAMM.json");
for (const [label, address, art] of [
  ["Token A (MockERC20)", TOKEN_A, erc20Art],
  ["Token B (MockERC20)", TOKEN_B, erc20Art],
  ["SimpleAMM          ", AMM, ammArt],
]) {
  const code = await provider.getCode(address);
  if (code === "0x") {
    check(`${label} ${address}`, false, "no contract code on this network");
    continue;
  }
  const same =
    stripMetadata(zeroImmutables(code, art.immutableReferences)) === stripMetadata(art.deployedBytecode);
  check(`${label} ${address}`, same, same ? "matches this repo's source" : "code differs from this repo");
}

const tokenA = new Contract(TOKEN_A, erc20Art.abi, provider);
const tokenB = new Contract(TOKEN_B, erc20Art.abi, provider);
const amm = new Contract(AMM, ammArt.abi, provider);

console.log("\nPool wiring");
const [poolA, poolB] = await Promise.all([amm.tokenA(), amm.tokenB()]);
check("tokenA() == VITE_TOKEN_A_ADDRESS", poolA.toLowerCase() === TOKEN_A.toLowerCase(), poolA);
check("tokenB() == VITE_TOKEN_B_ADDRESS", poolB.toLowerCase() === TOKEN_B.toLowerCase(), poolB);
for (const [label, token] of [["Token A", tokenA], ["Token B", tokenB]]) {
  const [symbol, decimals, owner, supply] = await Promise.all([
    token.symbol(),
    token.decimals(),
    token.owner(),
    token.totalSupply(),
  ]);
  check(`${label} is ${symbol} with 18 decimals`, decimals === 18n, `owner ${owner}, totalSupply ${fmt(supply)}`);
}

console.log("\nPool state");
const [reserveA, reserveB] = await amm.getReserves();
const [heldA, heldB, supply] = await Promise.all([tokenA.balanceOf(AMM), tokenB.balanceOf(AMM), amm.totalSupply()]);
row("reserveA / reserveB", `${fmt(reserveA)} TKA / ${fmt(reserveB)} TKB`);
row("LP totalSupply", `${fmt(supply)} vwLP`);
check("reserves == pool token balances", reserveA === heldA && reserveB === heldB, `${fmt(heldA)} / ${fmt(heldB)}`);

if (walletArg) {
  console.log(`\nWallet ${walletArg}`);
  const walletCode = await provider.getCode(walletArg);
  row(
    "account type",
    walletCode === "0x"
      ? "plain EOA"
      : walletCode.startsWith("0xef0100")
        ? `EIP-7702 smart account (delegates to 0x${walletCode.slice(8)}); msg.sender is still this address`
        : "contract"
  );
  const [balA, balB, allowA, allowB, lp] = await Promise.all([
    tokenA.balanceOf(walletArg),
    tokenB.balanceOf(walletArg),
    tokenA.allowance(walletArg, AMM),
    tokenB.allowance(walletArg, AMM),
    amm.balanceOf(walletArg),
  ]);
  row("TKA balance / allowance", `${fmt(balA)} / ${fmt(allowA)}`);
  row("TKB balance / allowance", `${fmt(balB)} / ${fmt(allowB)}`);
  row("vwLP balance", `${fmt(lp)}${supply > 0n ? ` (${((Number(lp) / Number(supply)) * 100).toFixed(2)}% of pool)` : ""}`);

  if (amountArg) {
    const aToB = directionArg !== "BtoA";
    const amountIn = parseUnits(amountArg, 18);
    const [inSym, outSym] = aToB ? ["TKA", "TKB"] : ["TKB", "TKA"];
    console.log(`\nSimulating ${aToB ? "swapAForB" : "swapBForA"}(${amountIn}) from the wallet (eth_call, nothing sent)`);
    row("amount in (base units)", `${amountIn} = ${amountArg} ${inSym}`);
    try {
      row("getAmountOut quote", `${fmt(await amm.getAmountOut(aToB ? TOKEN_A : TOKEN_B, amountIn))} ${outSym}`);
    } catch (error) {
      row("getAmountOut quote", `reverts: ${error.revert?.name ?? error.shortMessage}`);
    }
    try {
      const out = await (aToB ? amm.swapAForB : amm.swapBForA).staticCall(amountIn, { from: walletArg });
      row("simulation", `would SUCCEED, paying ${fmt(out)} ${outSym}`);
    } catch (error) {
      const name = error.revert?.name ?? "unknown";
      const args = error.revert?.args?.map(String) ?? [];
      row("simulation", `would REVERT with ${name}(${args.join(", ")})`);
      if (name === "InsufficientBalance") {
        console.log(
          `\n  Diagnosis: the wallet holds ${fmt(BigInt(args[1]))} ${inSym} but the swap needs ${fmt(BigInt(args[2]))}.` +
            (lp > 0n
              ? `\n  It owns ${fmt(lp)} vwLP — its ${inSym} is inside the pool as liquidity, not in the wallet.`
              : "") +
            `\n  Remedy: mint more ${inSym} (token owner only) or removeLiquidity() first. An allowance does not create a balance.`
        );
      } else if (name === "InsufficientAllowance") {
        console.log(`\n  Diagnosis: approve the pool for at least ${amountArg} ${inSym} first.`);
      }
    }
  }
}

console.log(failures ? `\n${failures} deployment check(s) FAILED.\n` : "\nAll deployment checks passed.\n");
process.exitCode = failures ? 1 : 0;
