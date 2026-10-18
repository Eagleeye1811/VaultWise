import { network } from "hardhat";

/**
 * VaultWise — Experiment 6 lifecycle demonstration (DEX prototype).
 *
 * Runs the sheet's ten testing scenarios in order on the in-process chain and
 * prints each setup, the hand calculation, and the real on-chain result —
 * success values or the exact revert — plus the optional LPFarm. This is the
 * "console output" evidence for the experiment.
 *
 * The scenarios use the sheet's numbers as RAW BASE UNITS (1000n, not
 * 1000e18), because that is the scale at which the sheet's results hold
 * (e.g. the 1,000 locked LP tokens).
 *
 *   npx hardhat run scripts/experiment6Lifecycle.js
 *
 * Local only: it advances block time and expects scenarios to revert.
 */

const { ethers, networkName, networkHelpers } = await network.getOrCreate();
if (networkName !== "default") throw new Error("Run the Experiment 6 lifecycle on the in-process chain only.");

const MAX = ethers.MaxUint256;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const row = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);
const header = (n, title) => console.log(`\n${"─".repeat(72)}\nSCENARIO ${n} — ${title}\n${"─".repeat(72)}`);
const amountOut = (i, rIn, rOut) => (i * 997n * rOut) / (rIn * 1000n + i * 997n);

const [owner, trader, other] = await ethers.getSigners();
const Token = await ethers.getContractFactory("DexMockERC20");
const pairIface = (await ethers.getContractFactory("Pair")).interface;

/** Fresh DEX: three tokens, Factory, Router, everybody funded and approved. */
async function freshDex() {
  const A = await Token.deploy("Token A", "DXA");
  const B = await Token.deploy("Token B", "DXB");
  const C = await Token.deploy("Token C", "DXC");
  const factory = await (await ethers.getContractFactory("Factory")).deploy();
  const router = await (await ethers.getContractFactory("Router")).deploy(await factory.getAddress());
  for (const user of [owner, trader, other]) {
    for (const t of [A, B, C]) {
      await t.mint(user.address, 10n ** 30n);
      await t.connect(user).approve(await router.getAddress(), MAX);
    }
  }
  const a = (t) => t.getAddress();
  const deadline = async () => (await networkHelpers.time.latest()) + 600;
  const add = async (X, Y, x, y, who = owner) =>
    (await router.connect(who).addLiquidity(await a(X), await a(Y), x, y, 0, 0, who.address, await deadline())).wait();
  const reserves = async (X, Y) => router.getReserves(await a(X), await a(Y));
  const pairOf = async (X, Y) => ethers.getContractAt("Pair", await factory.getPair(await a(X), await a(Y)));
  const swap = async (who, amountIn, min, path, dl) =>
    (
      await router
        .connect(who)
        .swapExactTokensForTokens(amountIn, min, await Promise.all(path.map(a)), who.address, dl ?? (await deadline()))
    ).wait();
  return { A, B, C, factory, router, a, add, reserves, pairOf, swap, deadline };
}

/** Run `fn`, expecting a revert; print the decoded error. */
async function expectRevert(label, fn, ifaces) {
  try {
    await fn();
    row(label, "UNEXPECTEDLY SUCCEEDED");
    process.exitCode = 1;
  } catch (error) {
    let name = error.revert?.name;
    for (const iface of ifaces) {
      if (name) break;
      const data = error.data ?? error.info?.error?.data;
      try {
        name = data ? iface.parseError(data)?.name : undefined;
      } catch {
        // not this contract's error
      }
    }
    row(label, `reverted with ${name ?? error.shortMessage ?? error.message}`);
  }
}

console.log("\nVaultWise — Experiment 6 lifecycle: the sheet's ten scenarios (raw base units)");

// 1 ------------------------------------------------------------------------
header(1, "First deposit");
{
  const d = await freshDex();
  await d.add(d.A, d.B, 1000n, 4000n, trader);
  const pair = await d.pairOf(d.A, d.B);
  row("hand calculation", "sqrt(1000 × 4000) − 1000 = 2000 − 1000 = 1000 LP");
  row("LP to depositor", (await pair.balanceOf(trader.address)).toString());
  row("LP locked at 0x…dEaD", (await pair.balanceOf(DEAD)).toString());
  row("totalSupply", (await pair.totalSupply()).toString());
  row("reserves A / B", (await d.reserves(d.A, d.B)).join(" / "));
  await pair.connect(trader).approve(await d.router.getAddress(), 1000n);
  await (
    await d.router.connect(trader).removeLiquidity(await d.a(d.A), await d.a(d.B), 1000n, 0, 0, trader.address, await d.deadline())
  ).wait();
  row("burn 1000 LP → reserves left", `${(await d.reserves(d.A, d.B)).join(" / ")} (500 A + 2000 B returned)`);
}

// 2–7 ----------------------------------------------------------------------
{
  const d = await freshDex();
  await d.add(d.A, d.B, 1000n, 2000n);
  const pair = await d.pairOf(d.A, d.B);
  const pairAddress = await pair.getAddress();
  const outsFor = async (amountB) => ((await pair.token0()) === (await d.a(d.B)) ? [amountB, 0n] : [0n, amountB]);
  const snapshot = await networkHelpers.takeSnapshot();

  header(2, "Basic swap — pool 1,000 A / 2,000 B, sell 100 A");
  row("hand calculation", `100·997·2000 / (1000·1000 + 100·997) = ${amountOut(100n, 1000n, 2000n)}`);
  const before = await d.B.balanceOf(trader.address);
  const receipt = await d.swap(trader, 100n, 0n, [d.A, d.B]);
  row("received", `${(await d.B.balanceOf(trader.address)) - before} B   (tx ${receipt.hash})`);
  const [rA, rB] = await d.reserves(d.A, d.B);
  row("reserves A / B", `${rA} / ${rB}`);
  row("k", `${rA * rB}  (was 2,000,000 — the 0.3 % fee stays in the pool)`);
  for (const log of receipt.logs) {
    if (log.address === pairAddress) {
      const parsed = pairIface.parseLog(log);
      if (parsed) row(`event ${parsed.name}`, parsed.args.map(String).join(", "));
    }
  }
  await snapshot.restore();

  header(3, "Asking for too much — 100 A in, ask for 182 B");
  row("hand calculation", "(1100·1000 − 300)·(1818·1000) = 1.9993e12 < 2.0e12");
  await d.A.connect(trader).transfer(pairAddress, 100n);
  await expectRevert("Pair.swap(…182 B…)", async () => pair.connect(trader).swap(...(await outsFor(182n)), trader.address), [pairIface]);
  await snapshot.restore();

  header(4, "No input sent — swap for 181 B without sending A");
  await expectRevert("Pair.swap(…181 B…)", async () => pair.connect(trader).swap(...(await outsFor(181n)), trader.address), [pairIface]);
  await snapshot.restore();

  header(5, "Slippage guard — another trader sells 20 A first");
  await d.swap(other, 20n, 0n, [d.A, d.B]);
  row("pool after the 20 A sale", (await d.reserves(d.A, d.B)).join(" / "));
  row("your 100 A would now get", `${amountOut(100n, 1020n, 1961n)} B  (needed ≥ 179)`);
  await expectRevert("swap(100, amountOutMin 179)", () => d.swap(trader, 100n, 179n, [d.A, d.B]), [d.router.interface]);
  await snapshot.restore();

  header(6, "Deadline already in the past");
  const past = (await networkHelpers.time.latest()) - 1;
  await expectRevert("swap(…, deadline = now − 1)", () => d.swap(trader, 100n, 0n, [d.A, d.B], past), [d.router.interface]);
  await snapshot.restore();

  header(7, "Allowance — Router approved for 100 A, swap 200 A");
  await d.A.connect(trader).approve(await d.router.getAddress(), 100n);
  await expectRevert("swap(200 A)", () => d.swap(trader, 200n, 0n, [d.A, d.B]), [d.A.interface]);
  await snapshot.restore();
}

// 8 ------------------------------------------------------------------------
header(8, "Multi-hop A → B → C");
{
  const d = await freshDex();
  await d.add(d.A, d.B, 1000n, 2000n);
  await d.add(d.B, d.C, 4000n, 500n);
  row("hand calculation", "100 A → 181 B; 181·997·500 / (4000·1000 + 181·997) = 21 C");
  row("getAmountsOut", (await d.router.getAmountsOut(100n, [await d.a(d.A), await d.a(d.B), await d.a(d.C)])).join(" → "));
  const before = await d.C.balanceOf(trader.address);
  await d.swap(trader, 100n, 21n, [d.A, d.B, d.C]);
  row("received", `${(await d.C.balanceOf(trader.address)) - before} C`);
  row("Pool 1 A / B", (await d.reserves(d.A, d.B)).join(" / "));
  row("Pool 2 B / C", (await d.reserves(d.B, d.C)).join(" / "));
}

// 9 ------------------------------------------------------------------------
header(9, "Wrong-ratio deposit — 500 A + 3,000 B into 1,000 / 4,000");
{
  const d = await freshDex();
  await d.add(d.A, d.B, 1000n, 4000n);
  const pair = await d.pairOf(d.A, d.B);
  row("supply before", (await pair.totalSupply()).toString());
  row("hand calculation", "quote(500) = 500·4000/1000 = 2000 ≤ 3000 → use 500 A + 2000 B");
  const [a0, b0] = [await d.A.balanceOf(trader.address), await d.B.balanceOf(trader.address)];
  await d.add(d.A, d.B, 500n, 3000n, trader);
  row("A / B actually taken", `${a0 - (await d.A.balanceOf(trader.address))} / ${b0 - (await d.B.balanceOf(trader.address))}`);
  row("LP minted", (await pair.balanceOf(trader.address)).toString());
}

// 10 -----------------------------------------------------------------------
header(10, "Duplicate pair");
{
  const d = await freshDex();
  await (await d.factory.createPair(await d.a(d.A), await d.a(d.B))).wait();
  row("getPair(A,B) == getPair(B,A)", String((await d.factory.getPair(await d.a(d.A), await d.a(d.B))) === (await d.factory.getPair(await d.a(d.B), await d.a(d.A)))));
  await expectRevert("createPair(B, A) again", async () => d.factory.createPair(await d.a(d.B), await d.a(d.A)), [d.factory.interface]);
}

// Optional ------------------------------------------------------------------
console.log(`\n${"─".repeat(72)}\nOPTIONAL — LPFarm: two LPs stake 1 : 3, reward 1 RWD per second\n${"─".repeat(72)}`);
{
  const d = await freshDex();
  const T = (x) => ethers.parseUnits(String(x), 18);
  await d.add(d.A, d.B, T(1000), T(1000), trader);
  await d.add(d.A, d.B, T(3000), T(3000), other);
  const lp = await d.pairOf(d.A, d.B);
  const rwd = await Token.deploy("Reward", "RWD");
  const farm = await (await ethers.getContractFactory("LPFarm")).deploy(await lp.getAddress(), await rwd.getAddress(), T(1));
  await rwd.mint(await farm.getAddress(), T(1000));
  for (const user of [trader, other]) {
    await lp.connect(user).approve(await farm.getAddress(), MAX);
    await farm.connect(user).deposit(await lp.balanceOf(user.address));
  }
  await networkHelpers.time.increase(40);
  row("after 40 s — trader pending", `${ethers.formatUnits(await farm.pendingReward(trader.address), 18)} RWD`);
  row("after 40 s — other pending", `${ethers.formatUnits(await farm.pendingReward(other.address), 18)} RWD`);
  row("expected", "trader: 2 s alone (the other LP's approve + deposit blocks) + 40 s × 1/4 = 12; other: 40 × 3/4 = 30");
  row("rounding", "the farm rounds down, so a few base units of dust stay in the farm");
}

console.log("\nDone.\n");
