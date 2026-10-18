import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { Contract, formatUnits, getCreateAddress, parseUnits } from "ethers";

/**
 * VaultWise — Experiment 5 on-chain state inspection (READ-ONLY).
 *
 * Shared by `checkExperiment5.js` (no key, public RPC) and
 * `resumeExperiment5.js` (re-checks before every step). Given the deployment
 * record, it establishes from the chain alone which of the deploy script's
 * ten steps are done:
 *
 *   1 LPT deployed      2 farm RWD deployed    3 100 LPT minted to deployer
 *   4 SimpleYieldFarm   5 1 000 RWD in farm     6 ABC deployed
 *   7 staking RWD       8 100 ABC minted        9 SimpleStaking deployed
 *  10 1 000 RWD in SimpleStaking
 *
 * Every contract is checked against this repo's compiled bytecode, its token
 * metadata/owner/wiring, and — where the record has one — its deployment
 * receipt. It also lists every contract the deployer created since LPT (by
 * CREATE address per nonce), so a duplicate or unrecorded SimpleStaking is
 * found instead of deployed twice.
 */

const ROOT = new URL("../..", import.meta.url).pathname;
export const RECORD_PATH = `${ROOT}deployments/sepolia-experiment5.json`;
export const SEPOLIA_CHAIN_ID = 11155111n;

const ONE_HUNDRED = parseUnits("100", 18);
const ONE_THOUSAND = parseUnits("1000", 18);
const fmt = (raw) => formatUnits(raw, 18);
const same = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

const artifact = (path) => JSON.parse(readFileSync(`${ROOT}artifacts/contracts/${path}`, "utf8"));
export const ARTIFACTS = {
  MockERC20: artifact("experiment4/MockERC20.sol/MockERC20.json"),
  SimpleYieldFarm: artifact("experiment5/SimpleYieldFarm.sol/SimpleYieldFarm.json"),
  SimpleStaking: artifact("experiment5/SimpleStaking.sol/SimpleStaking.json"),
};

/** Remove the trailing CBOR metadata, whose length is the last two bytes. */
function stripMetadata(hex) {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const length = parseInt(body.slice(-4), 16);
  return body.slice(0, body.length - (length + 2) * 2);
}

/** Zero out immutable slots so on-chain and compiled runtime code compare equal. */
function zeroImmutables(hex, refs = {}) {
  let body = hex.startsWith("0x") ? hex.slice(2) : hex;
  for (const list of Object.values(refs)) {
    for (const { start, length } of list) {
      body = body.slice(0, start * 2) + "0".repeat(length * 2) + body.slice((start + length) * 2);
    }
  }
  return `0x${body}`;
}

/** Which repo contract (if any) this runtime code is. */
export function identify(code, artifacts = ARTIFACTS) {
  if (!code || code === "0x") return null;
  for (const [name, art] of Object.entries(artifacts)) {
    if (stripMetadata(zeroImmutables(code, art.immutableReferences)) === stripMetadata(art.deployedBytecode)) return name;
  }
  return "unknown";
}

export function loadRecord(path = RECORD_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Write atomically, so an interrupted run never leaves a half-written record. */
export function saveRecord(record, path = RECORD_PATH) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * Inspect the chain.
 * @returns {Promise<{ ok: boolean, problems: string[], lines: string[], steps: object[], facts: object }>}
 */
export async function inspect(provider, record, { chainId: expectedChainId = SEPOLIA_CHAIN_ID } = {}) {
  const problems = [];
  const lines = [];
  const say = (ok, label, detail = "") => {
    lines.push(`  [${ok === null ? "TODO" : ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok === false) problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  };

  const { chainId } = await provider.getNetwork();
  say(chainId === expectedChainId, `chain id is ${expectedChainId}`, `got ${chainId}`);
  const deployer = record.deployer;
  if (!deployer) throw new Error("The record has no `deployer` address.");

  const yf = record.yieldFarming ?? {};
  const st = record.staking ?? {};
  const facts = { deployer };

  /** Verify one recorded contract: code, bytecode identity, deploy receipt. */
  async function checkContract(label, entry, expectedName) {
    if (!entry?.address) return false;
    const code = await provider.getCode(entry.address);
    const name = identify(code);
    say(name === expectedName, `${label} at ${entry.address}`, name ? `bytecode = ${name}` : "no contract code");
    if (name !== expectedName) return false;
    if (entry.txHash) {
      const receipt = await provider.getTransactionReceipt(entry.txHash);
      const good =
        receipt && receipt.status === 1 && same(receipt.from, deployer) && same(receipt.contractAddress, entry.address);
      say(Boolean(good), `${label} deploy receipt ${entry.txHash}`, receipt ? `status ${receipt.status}, block ${receipt.blockNumber}` : "not found");
    }
    return true;
  }

  async function checkToken(label, entry, name, symbol) {
    if (!(await checkContract(label, entry, "MockERC20"))) return null;
    const token = new Contract(entry.address, ARTIFACTS.MockERC20.abi, provider);
    const [n, s, d, owner] = await Promise.all([token.name(), token.symbol(), token.decimals(), token.owner()]);
    say(n === name && s === symbol && d === 18n, `${label} metadata`, `"${n}" / ${s} / ${d} decimals`);
    say(same(owner, deployer), `${label} owner() is the deployer`, owner);
    return token;
  }

  async function checkPool(label, entry, contractName, stakeAddress, rewardAddress) {
    if (!(await checkContract(label, entry, contractName))) return null;
    const pool = new Contract(entry.address, ARTIFACTS[contractName].abi, provider);
    const [s, r, rate] = await Promise.all([pool.stakingToken(), pool.rewardToken(), pool.rewardRate()]);
    say(same(s, stakeAddress) && same(r, rewardAddress) && rate === 10n ** 15n, `${label} wiring`, `stakingToken ${s}, rewardToken ${r}, rewardRate ${rate}`);
    return pool;
  }

  lines.push("\nPart 1 — yield farming");
  const lpt = await checkToken("LPT (MockERC20)", yf.LPT, "LP Token", "LPT");
  const rwd1 = await checkToken("farm RWD (MockERC20)", yf.RWD, "Reward Token", "RWD");
  const farm = lpt && rwd1 ? await checkPool("SimpleYieldFarm", yf.SimpleYieldFarm, "SimpleYieldFarm", yf.LPT.address, yf.RWD.address) : null;
  facts.lptBalance = lpt ? await lpt.balanceOf(deployer) : null;
  facts.farmFunding = rwd1 && farm ? await rwd1.balanceOf(yf.SimpleYieldFarm.address) : null;

  lines.push("\nPart 2 — protocol staking");
  const abc = await checkToken("ABC (MockERC20)", st.ABC, "Protocol Token", "ABC");
  const rwd2 = await checkToken("staking RWD (MockERC20)", st.RWD, "Reward Token", "RWD");
  if (abc && rwd1 && rwd2) {
    say(!same(st.RWD.address, yf.RWD.address), "Part 2 has its own RWD (not the farm's)");
  }
  facts.abcBalance = abc ? await abc.balanceOf(deployer) : null;
  facts.abcSupply = abc ? await abc.totalSupply() : null;

  // ---- every contract the deployer created since LPT, by CREATE address ----
  const latestNonce = await provider.getTransactionCount(deployer, "latest");
  const pendingNonce = await provider.getTransactionCount(deployer, "pending");
  facts.latestNonce = latestNonce;
  facts.pendingNonce = pendingNonce;
  let fromNonce = Math.max(0, latestNonce - 40);
  if (yf.LPT?.txHash) {
    const tx = await provider.getTransaction(yf.LPT.txHash);
    if (tx) fromNonce = tx.nonce;
  }
  const created = [];
  for (let nonce = fromNonce; nonce < latestNonce; nonce += 1) {
    const address = getCreateAddress({ from: deployer, nonce });
    const name = identify(await provider.getCode(address));
    if (name) created.push({ nonce, address, name });
  }
  facts.created = created;
  const stakings = [];
  for (const c of created.filter((x) => x.name === "SimpleStaking")) {
    const pool = new Contract(c.address, ARTIFACTS.SimpleStaking.abi, provider);
    const [s, r] = await Promise.all([pool.stakingToken(), pool.rewardToken()]);
    if (abc && rwd2 && same(s, st.ABC.address) && same(r, st.RWD.address)) stakings.push(c.address);
  }
  facts.stakingCandidates = stakings;

  // ---- SimpleStaking: recorded, discovered, or not deployed ----
  let staking = null;
  if (st.SimpleStaking?.address) {
    staking = abc && rwd2 ? await checkPool("SimpleStaking", st.SimpleStaking, "SimpleStaking", st.ABC.address, st.RWD.address) : null;
    const extra = stakings.filter((a) => !same(a, st.SimpleStaking.address));
    say(extra.length === 0, "no duplicate SimpleStaking for ABC/RWD", extra.length ? `also found ${extra.join(", ")}` : "");
  } else if (stakings.length === 1) {
    say(null, "SimpleStaking not in the record", `but the deployer created one at ${stakings[0]} — it will be adopted, not redeployed`);
  } else if (stakings.length > 1) {
    say(false, "more than one SimpleStaking for ABC/RWD", stakings.join(", "));
  }
  const stakingAddress = st.SimpleStaking?.address ?? (stakings.length === 1 ? stakings[0] : null);
  facts.stakingAddress = stakingAddress;
  facts.stakingFunding = rwd2 && stakingAddress ? await rwd2.balanceOf(stakingAddress) : null;

  // ---- the ten steps ----
  const steps = [
    { n: 1, label: "Deploy LPT", done: Boolean(lpt) },
    { n: 2, label: "Deploy farm RWD", done: Boolean(rwd1) },
    { n: 3, label: "Mint 100 LPT to the deployer", done: facts.lptBalance !== null && facts.lptBalance >= ONE_HUNDRED, detail: facts.lptBalance !== null ? `${fmt(facts.lptBalance)} LPT` : "" },
    { n: 4, label: "Deploy SimpleYieldFarm(LPT, RWD)", done: Boolean(farm) },
    { n: 5, label: "Fund SimpleYieldFarm with 1 000 RWD", done: facts.farmFunding !== null && facts.farmFunding >= ONE_THOUSAND, detail: facts.farmFunding !== null ? `${fmt(facts.farmFunding)} RWD` : "" },
    { n: 6, label: "Deploy ABC", done: Boolean(abc) },
    { n: 7, label: "Deploy staking RWD", done: Boolean(rwd2) },
    { n: 8, label: "Mint 100 ABC to the deployer", done: facts.abcBalance !== null && facts.abcBalance >= ONE_HUNDRED, detail: facts.abcBalance !== null ? `${fmt(facts.abcBalance)} ABC held, totalSupply ${fmt(facts.abcSupply)}` : "" },
    { n: 9, label: "Deploy SimpleStaking(ABC, RWD)", done: Boolean(staking) || stakings.length === 1, detail: stakingAddress ?? "" },
    { n: 10, label: "Fund SimpleStaking with 1 000 RWD", done: facts.stakingFunding !== null && facts.stakingFunding >= ONE_THOUSAND, detail: facts.stakingFunding !== null ? `${fmt(facts.stakingFunding)} RWD` : "" },
  ];

  // ABC minted to someone else, or supply without the deployer holding it, is unexpected.
  if (facts.abcSupply !== null && facts.abcSupply > 0n && facts.abcBalance < ONE_HUNDRED) {
    say(false, "ABC state", `totalSupply ${fmt(facts.abcSupply)} but the deployer holds ${fmt(facts.abcBalance)} — investigate before minting`);
  }
  say(pendingNonce <= latestNonce, "deployer has no pending transactions", `latest nonce ${latestNonce}, pending ${pendingNonce}`);

  return { ok: problems.length === 0, problems, lines, steps, facts };
}

/** Print an inspection report. */
export function printReport({ lines, steps, facts, problems }) {
  for (const line of lines) console.log(line);
  console.log("\nContracts created by the deployer since LPT (CREATE address per nonce)");
  for (const c of facts.created) console.log(`  nonce ${String(c.nonce).padStart(4)}  ${c.address}  ${c.name}`);
  console.log("\nDeployment steps");
  for (const s of steps) console.log(`  ${s.done ? "✓" : "·"} ${String(s.n).padStart(2)}. ${s.label}${s.detail ? `  (${s.detail})` : ""}`);
  console.log(problems.length ? `\n${problems.length} problem(s) found — do NOT resume until resolved.` : "\nNo problems found.");
}
