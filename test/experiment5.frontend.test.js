import { expect } from "chai";
import { network } from "hardhat";

import {
  accrued,
  decodeRevert,
  explainRevert,
  formatDuration,
  fundingRunwaySeconds,
  payoutProblem,
  projectEarned,
  rewardPerSecond,
} from "../frontend/src/experiments/experiment5/rewardMath.js";

/**
 * VaultWise — Experiment 5 frontend logic
 * =======================================
 *
 * The browser code that projects rewards between chain reads, blocks payouts
 * the pool cannot fund, and explains reverts. It is plain JavaScript with no
 * React or wallet dependency, so it runs here against the real compiled
 * SimpleYieldFarm and SimpleStaking on the in-process Hardhat chain.
 *
 * Not covered here: React rendering and the live MetaMask popup.
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;
const T = (amount) => ethers.parseUnits(String(amount), 18);
const RATE = 10n ** 15n;
const PRECISION = 10n ** 18n;

describe("VaultWise Experiment 5 — frontend logic", function () {
  describe("Reward arithmetic mirrors the contracts", function () {
    it("accrued() reproduces the sheet's example and floors like Solidity", function () {
      expect(accrued(T(100), RATE, PRECISION, 60)).to.equal(T(6));
      expect(accrued(T(60), RATE, PRECISION, 60)).to.equal(T(3.6));
      expect(accrued(1n, RATE, PRECISION, 999)).to.equal(0n);
      expect(accrued(T(100), RATE, PRECISION, -5)).to.equal(0n); // never negative
      expect(accrued(null, RATE, PRECISION, 60)).to.equal(null);
      expect(rewardPerSecond(T(100), RATE, PRECISION)).to.equal(T(0.1));
    });

    it("projectEarned() matches the contract's earned() at a later block", async function () {
      const [, alice] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const lpt = await MockERC20.deploy("LP Token", "LPT");
      const rwd = await MockERC20.deploy("Reward Token", "RWD");
      const farm = await (await ethers.getContractFactory("SimpleYieldFarm")).deploy(
        await lpt.getAddress(),
        await rwd.getAddress()
      );
      await lpt.mint(alice.address, T(100));
      await lpt.connect(alice).approve(await farm.getAddress(), T(100));
      await farm.connect(alice).stake(T(73));

      // Read once (as the UI does), then project 45 s ahead.
      await time.increase(10);
      const block = await ethers.provider.getBlock("latest");
      const earnedAtRead = await farm.earned(alice.address);
      const projected = projectEarned({
        earnedAtRead,
        staked: await farm.stakedBalance(alice.address),
        rate: await farm.rewardRate(),
        precision: await farm.REWARD_PRECISION(),
        readTimestamp: block.timestamp,
        chainNow: block.timestamp + 45,
      });

      await time.increaseTo(block.timestamp + 45);
      expect(projected).to.equal(await farm.earned(alice.address));
    });

    it("estimates the funding runway and formats durations", function () {
      // 1000 RWD at 0.1 RWD/s (100 staked) lasts 10 000 s.
      expect(fundingRunwaySeconds(T(1000), T(100), RATE, PRECISION)).to.equal(10_000);
      expect(fundingRunwaySeconds(T(1000), 0n, RATE, PRECISION)).to.equal(null);
      expect(formatDuration(59)).to.equal("59 s");
      expect(formatDuration(10_000)).to.equal("2 h 46 min");
    });
  });

  describe("Payout funding check", function () {
    it("blocks a payout above the pool's RWD balance, with the numbers", function () {
      const problem = payoutProblem({ earned: T(6), rewardBalance: T(5), noun: "farm" });
      expect(problem).to.include("holds only 5.0 RWD");
      expect(problem).to.include("owes you 6.0 RWD");
      expect(payoutProblem({ earned: T(6), rewardBalance: T(6) })).to.equal(null);
      expect(payoutProblem({ earned: null, rewardBalance: T(6) })).to.equal(null);
    });
  });

  for (const [contractName, sym, claimFn, withdrawFn] of [
    ["SimpleYieldFarm", "LPT", "harvest", "withdraw"],
    ["SimpleStaking", "ABC", "claimReward", "unstake"],
  ]) {
    describe(`Revert explanations — ${contractName}`, function () {
      let pool;
      let stk;
      let alice;

      beforeEach(async function () {
        [, alice] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        stk = await MockERC20.deploy("Staking", sym);
        const rwd = await MockERC20.deploy("Reward Token", "RWD");
        pool = await (await ethers.getContractFactory(contractName)).deploy(
          await stk.getAddress(),
          await rwd.getAddress()
        );
        await stk.mint(alice.address, T(100));
      });

      /** Simulate a call from Alice and return the explanation the UI would show. */
      async function explain(fn, args = []) {
        try {
          await pool.connect(alice)[fn].staticCall(...args);
        } catch (error) {
          return explainRevert(decodeRevert(error, pool.interface), {
            stakeSymbol: sym,
            rewardSymbol: "RWD",
            noun: "farm",
            withdrawVerb: withdrawFn,
          });
        }
        throw new Error(`${fn} did not revert`);
      }

      it("explains a missing approval and an over-balance stake with real numbers", async function () {
        expect(await explain("stake", [T(10)])).to.equal(
          `The farm is approved to pull 0.0 ${sym}, but this stake needs 10.0. Approve at least that amount first.`
        );
        await stk.connect(alice).approve(await pool.getAddress(), T(500));
        expect(await explain("stake", [T(150)])).to.equal(
          `Your wallet holds 100.0 ${sym}, but this stake needs 150.0 ${sym}.`
        );
        expect(await explain("stake", [0n])).to.equal("Enter an amount greater than zero.");
      });

      it("explains an excessive withdrawal, an empty claim, an empty exit and missing funding", async function () {
        expect(await explain(withdrawFn, [T(1)])).to.equal(`You have 0.0 ${sym} staked, so you cannot ${withdrawFn} 1.0.`);
        expect(await explain(claimFn)).to.include("No reward has accrued yet");
        expect(await explain("exit")).to.include("nothing to exit");

        await stk.connect(alice).approve(await pool.getAddress(), T(100));
        await pool.connect(alice).stake(T(100));
        await time.increase(60);
        expect(await explain(claimFn)).to.match(/holds only 0\.0 RWD but must pay 6\.\d+ RWD/);
      });

      it("decodes raw revert data when ethers did not decode it", function () {
        const data = pool.interface.encodeErrorResult("InsufficientStakedBalance", [T(60), T(61)]);
        const revert = decodeRevert({ info: { error: { data } } }, pool.interface);
        expect(revert.name).to.equal("InsufficientStakedBalance");
        expect(explainRevert(revert, { stakeSymbol: sym, withdrawVerb: withdrawFn })).to.equal(
          `You have 60.0 ${sym} staked, so you cannot ${withdrawFn} 61.0.`
        );
        expect(decodeRevert({ data: "0x1234" }, pool.interface)).to.equal(null);
        expect(explainRevert({ name: "SomethingElse", args: [] })).to.equal(null);
      });
    });
  }
});
