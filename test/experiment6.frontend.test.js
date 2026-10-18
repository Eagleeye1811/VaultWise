import { expect } from "chai";
import { network } from "hardhat";

import {
  applySlippage,
  deadlineFrom,
  decodeRevert,
  estimateBurn,
  estimateLiquidity,
  explainRevert,
  findRoutes,
  getAmountOut,
  getAmountsOut,
  optimalAmounts,
  priceImpactPpm,
  quote,
} from "../frontend/src/experiments/experiment6/dexMath.js";

/**
 * VaultWise — Experiment 6 frontend logic
 * =======================================
 *
 * The browser's DEX maths (quotes, routes, ratio-preserving deposits, LP
 * estimates, slippage minimums, deadlines) and revert explanations, checked
 * against what the real compiled Router and Pair do on the in-process chain.
 *
 * Not covered here: React rendering and the live MetaMask popup.
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;
const MAX = ethers.MaxUint256;

describe("VaultWise Experiment 6 — frontend logic", function () {
  let owner;
  let trader;
  let tokens; // { A, B, C }
  let factory;
  let router;
  let ifaces;

  const addr = (key) => tokens[key].getAddress();
  const later = async () => (await time.latest()) + 600;

  /** Reserves in (x, y) order from the chain, or null without a funded pool — as DexView provides them. */
  const reservesFromChain = async () => {
    const out = {};
    for (const [x, y] of [["A", "B"], ["B", "C"], ["A", "C"], ["B", "A"], ["C", "B"], ["C", "A"]]) {
      const [rx, ry] = await router.getReserves(await addr(x), await addr(y));
      out[x + y] = rx > 0n && ry > 0n ? [rx, ry] : null;
    }
    return (x, y) => out[x + y];
  };

  async function add(x, y, ax, ay, who = owner) {
    await router.connect(who).addLiquidity(await addr(x), await addr(y), ax, ay, 0, 0, who.address, await later());
  }

  /** Explanation the UI would show for a failing call. */
  async function explain(promiseFn) {
    try {
      await promiseFn();
    } catch (error) {
      return explainRevert(decodeRevert(error, ifaces), {
        symbolOf: (address) => tokensByAddress[address] ?? address,
      });
    }
    throw new Error("call did not revert");
  }
  let tokensByAddress;

  beforeEach(async function () {
    [owner, trader] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DexMockERC20");
    tokens = {
      A: await Token.deploy("Token A", "DXA"),
      B: await Token.deploy("Token B", "DXB"),
      C: await Token.deploy("Token C", "DXC"),
    };
    tokensByAddress = { [await addr("A")]: "DXA", [await addr("B")]: "DXB", [await addr("C")]: "DXC" };
    factory = await (await ethers.getContractFactory("Factory")).deploy();
    router = await (await ethers.getContractFactory("Router")).deploy(await factory.getAddress());
    for (const user of [owner, trader]) {
      for (const t of Object.values(tokens)) {
        await t.mint(user.address, 10n ** 30n);
        await t.connect(user).approve(await router.getAddress(), MAX);
      }
    }
    ifaces = [router.interface, (await ethers.getContractFactory("Pair")).interface, factory.interface, tokens.A.interface];
  });

  describe("Quotes mirror the Router", function () {
    it("getAmountOut matches Router.getAmountOut across sizes, including the sheet's 181", async function () {
      expect(getAmountOut(100n, 1000n, 2000n)).to.equal(181n);
      for (const [i, r1, r2] of [
        [1n, 1000n, 2000n],
        [100n, 1020n, 1961n],
        [181n, 4000n, 500n],
        [ethers.parseUnits("3.7", 18), ethers.parseUnits("1000", 18), ethers.parseUnits("2500", 18)],
      ]) {
        expect(getAmountOut(i, r1, r2)).to.equal(await router.getAmountOut(i, r1, r2));
      }
      expect(getAmountOut(0n, 1n, 1n)).to.equal(null);
    });

    it("getAmountsOut on live reserves matches the Router's multi-hop quote (scenario 8)", async function () {
      await add("A", "B", 1000n, 2000n);
      await add("B", "C", 4000n, 500n);
      const reservesOf = await reservesFromChain();
      const local = getAmountsOut(100n, ["A", "B", "C"], reservesOf);
      expect(local).to.deep.equal([100n, 181n, 21n]);
      expect(local).to.deep.equal(await router.getAmountsOut(100n, [await addr("A"), await addr("B"), await addr("C")]));
      expect(getAmountsOut(100n, ["A", "C"], reservesOf)).to.equal(null); // no A/C pool
    });

    it("findRoutes offers the direct pool and the route through the third token", async function () {
      await add("A", "B", 1000n, 2000n);
      await add("B", "C", 4000n, 500n);
      const reservesOf = await reservesFromChain();
      const has = (x, y) => reservesOf(x, y) !== null;
      expect(findRoutes("A", "C", ["A", "B", "C"], has)).to.deep.equal([["A", "B", "C"]]);
      expect(findRoutes("A", "B", ["A", "B", "C"], has)).to.deep.equal([["A", "B"]]);
      expect(findRoutes("A", "A", ["A", "B", "C"], has)).to.deep.equal([]);
    });
  });

  describe("Liquidity previews mirror the Router and Pair", function () {
    it("optimalAmounts + estimateLiquidity reproduce scenario 9 and the Router's result", async function () {
      await add("A", "B", 1000n, 4000n);
      const used = optimalAmounts(500n, 3000n, 1000n, 4000n);
      expect(used).to.deep.equal({ amountA: 500n, amountB: 2000n });
      expect(estimateLiquidity(used.amountA, used.amountB, 1000n, 4000n, 2000n)).to.equal(1000n);
      const onChain = await router
        .connect(trader)
        .addLiquidity.staticCall(await addr("A"), await addr("B"), 500n, 3000n, 0, 0, trader.address, await later());
      expect([used.amountA, used.amountB, 1000n]).to.deep.equal([...onChain]);
      // B is the short side: A is reduced instead
      expect(optimalAmounts(500n, 1000n, 1000n, 4000n)).to.deep.equal({ amountA: 250n, amountB: 1000n });
      expect(quote(500n, 1000n, 4000n)).to.equal(2000n);
    });

    it("estimateLiquidity matches the first deposit (√(x·y) − 1000) and estimateBurn the Pair's burn", async function () {
      expect(estimateLiquidity(1000n, 4000n, 0n, 0n, 0n)).to.equal(1000n);
      expect(estimateLiquidity(1000n, 1000n, 0n, 0n, 0n)).to.equal(0n); // too small
      expect(estimateBurn(1000n, 1000n, 4000n, 2000n)).to.deep.equal({ amountA: 500n, amountB: 2000n });
    });
  });

  describe("Slippage, deadlines and price impact", function () {
    it("applySlippage rounds the minimum down; scenario 5's 179 limit fails against 174", function () {
      expect(applySlippage(181n, 100)).to.equal(179n); // 1 %
      expect(applySlippage(1000n, 50)).to.equal(995n);
      expect(applySlippage(174n, 0)).to.equal(174n);
      expect(174n < applySlippage(181n, 100)).to.equal(true);
    });

    it("deadlineFrom counts from the chain's block time", async function () {
      const now = await time.latest();
      expect(deadlineFrom(now, 20)).to.equal(BigInt(now + 1200));
    });

    it("price impact includes the 0.3 % fee: 100 into 1,000/2,000 executes 9.5 % below spot", function () {
      // spot out 200, real out 181 -> (200 - 181) / 200 = 9.5 %
      expect(priceImpactPpm(100n, 181n, 1000n, 2000n)).to.equal(95_000);
    });
  });

  describe("Revert explanations from real reverts", function () {
    beforeEach(async function () {
      await add("A", "B", 1000n, 2000n);
    });

    it("explains EXPIRED, INSUFFICIENT_OUTPUT_AMOUNT and PAIR_NOT_FOUND", async function () {
      const [a, b, c] = [await addr("A"), await addr("B"), await addr("C")];
      const past = (await time.latest()) - 1;
      expect(await explain(() => router.connect(trader).swapExactTokensForTokens.staticCall(100n, 0n, [a, b], trader.address, past))).to.match(/^EXPIRED/);
      expect(
        await explain(async () => router.connect(trader).swapExactTokensForTokens.staticCall(100n, 182n, [a, b], trader.address, await later()))
      ).to.match(/^INSUFFICIENT_OUTPUT_AMOUNT/);
      expect(await explain(() => router.getAmountsOut(100n, [a, c]))).to.equal(
        "PAIR_NOT_FOUND — there is no DXA/DXC pool. Create it or pick another route."
      );
    });

    it("explains PAIR_EXISTS, K and a too-small allowance", async function () {
      const [a, b] = [await addr("A"), await addr("B")];
      expect(await explain(() => factory.createPair.staticCall(b, a))).to.match(/^PAIR_EXISTS/);

      const pair = await ethers.getContractAt("Pair", await factory.getPair(a, b));
      await tokens.A.connect(trader).transfer(await pair.getAddress(), 100n);
      const outs = (await pair.token0()) === b ? [182n, 0n] : [0n, 182n];
      expect(await explain(() => pair.connect(trader).swap.staticCall(...outs, trader.address))).to.match(/^K —/);

      await tokens.A.connect(trader).approve(await router.getAddress(), 100n);
      expect(
        await explain(async () => router.connect(trader).swapExactTokensForTokens.staticCall(200n, 0n, [a, b], trader.address, await later()))
      ).to.include("approved for only 0.0000000000000001");
    });
  });
});
