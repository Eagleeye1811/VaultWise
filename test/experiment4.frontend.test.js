import { expect } from "chai";
import { network } from "hardhat";

import {
  estimateLpShares,
  estimateRemoval,
  formatPpm,
  formatRatio,
  matchingAmount,
  minOutForTolerance,
  priceImpactPpm,
  sqrt,
} from "../frontend/src/experiments/experiment4/ammMath.js";
import { decodeRevert, explainRevert, preflightProblems } from "../frontend/src/experiments/experiment4/swapChecks.js";
import { friendlyError } from "../frontend/src/utils/errors.js";
import {
  IDLE_TX,
  awaitingSignature,
  confirmed,
  failed,
  reverted,
  submitted,
} from "../frontend/src/utils/txState.js";

/**
 * VaultWise — Experiment 4 frontend logic
 * =======================================
 *
 * The browser code that decides whether a swap may be sent, what the user is
 * told when it cannot, and how a transaction's state is shown. It is plain
 * JavaScript with no React or wallet dependency, so it runs here against the
 * real compiled contracts on the in-process Hardhat chain.
 *
 * Not covered here: React rendering and the live MetaMask popup.
 */

const { ethers } = await network.getOrCreate();
const T = (amount) => ethers.parseUnits(String(amount), 18);
const SEPOLIA = 11155111n;

// friendlyError logs the raw error for debugging; keep test output readable.
const quietly = (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

/** A fully healthy set of pre-swap facts; each test breaks one thing. */
const healthy = () => ({
  chainId: SEPOLIA,
  targetChainId: SEPOLIA,
  account: "0xcd1a6b2f01feddf7520c0eb3306027a2c6c4c730",
  signerAddress: "0xcD1a6B2f01fEddF7520C0Eb3306027a2c6c4c730",
  poolTokenIn: "0x785BD01f7EA2BFD11f7Dfa3e53129b83Ab807138",
  configuredTokenIn: "0x785bd01f7ea2bfd11f7dfa3e53129b83ab807138",
  amountIn: T(1),
  balance: T(5),
  allowance: T(10),
  reserveIn: T(100),
  reserveOut: T(100),
  lpBalance: 0n,
  symbolIn: "TKA",
});

describe("VaultWise Experiment 4 — frontend logic", function () {
  // =================================================================
  // 20. Wallet / network mismatch handling
  // =================================================================
  describe("20. Pre-swap checks: wallet, network and wiring", function () {
    it("passes a healthy swap, comparing addresses case-insensitively", function () {
      expect(preflightProblems(healthy())).to.deep.equal([]);
    });

    it("blocks the wrong chain", function () {
      const problems = preflightProblems({ ...healthy(), chainId: 1n });
      expect(problems).to.have.length(1);
      expect(problems[0]).to.match(/chain 1, not 11155111/);
    });

    it("blocks when MetaMask would sign with a different account than the page shows", function () {
      const problems = preflightProblems({
        ...healthy(),
        signerAddress: "0x1111111111111111111111111111111111111111",
      });
      expect(problems[0]).to.match(/would sign with 0x1111/);
    });

    it("blocks when the pool's token differs from the configured token", function () {
      const problems = preflightProblems({
        ...healthy(),
        poolTokenIn: "0xfD6f659d80e0E7aF1bbddA58c33c73C855C2114b",
      });
      expect(problems[0]).to.match(/configured with/);
    });

    it("blocks an empty pool, an empty balance and a short allowance — each with its numbers", function () {
      const problems = preflightProblems({
        ...healthy(),
        reserveIn: 0n,
        balance: 0n,
        allowance: T(0.5),
      });
      expect(problems).to.have.length(3);
      expect(problems[0]).to.match(/no liquidity/);
      expect(problems[1]).to.match(/holds 0\.0 TKA, but this swap needs 1\.0 TKA/);
      expect(problems[2]).to.match(/only 0\.5 TKA/);
    });

    it("explains the Sepolia case: tokens deposited as liquidity are not in the wallet", function () {
      const problems = preflightProblems({ ...healthy(), balance: 0n, lpBalance: T(100) });
      expect(problems).to.have.length(1);
      expect(problems[0]).to.match(/You own 100\.0 LP shares/);
      expect(problems[0]).to.match(/An approval does not add tokens/);
    });
  });

  // =================================================================
  // 21. Failed, rejected and pending transaction states
  // =================================================================
  describe("21. Transaction states", function () {
    it("walks idle -> awaiting signature -> submitted -> confirmed", function () {
      expect(IDLE_TX.status).to.equal("idle");

      let tx = awaitingSignature(["Approve TKA", "Swap"], 1, []);
      expect(tx).to.include({ status: "pending", hash: null });
      expect(tx.steps.map((s) => s.state)).to.deep.equal(["done", "active"]);

      tx = submitted(tx, "0xabc", "Swapping...");
      expect(tx).to.include({ status: "pending", hash: "0xabc", message: "Swapping..." });

      tx = confirmed({ hash: "0xabc", success: "Done", steps: ["Approve TKA", "Swap"], activeStep: 1, finalStep: true, events: [] });
      expect(tx.status).to.equal("confirmed");
      expect(tx.steps.map((s) => s.state)).to.deep.equal(["done", "done"]);
    });

    it("keeps a non-final step pending so the flow can continue", function () {
      const tx = confirmed({ hash: "0x1", success: "Approved", steps: ["Approve", "Swap"], activeStep: 0, finalStep: false, events: [] });
      expect(tx.status).to.equal("pending");
      expect(tx.steps.map((s) => s.state)).to.deep.equal(["done", "active"]);
    });

    it("marks a mined-but-reverted tx failed and keeps its real hash", function () {
      const tx = reverted(submitted(awaitingSignature([], 0, []), "0xdead", "..."), "0xdead");
      expect(tx).to.include({ status: "failed", hash: "0xdead" });
    });

    it("marks a rejected signature failed with no hash", function () {
      const start = awaitingSignature([], 0, []);
      const message = quietly(() => friendlyError({ code: "ACTION_REJECTED" }));
      const tx = failed(start, message);
      expect(tx).to.include({ status: "failed", hash: null });
      expect(tx.message).to.equal("You rejected the transaction in MetaMask.");
      expect(quietly(() => friendlyError({ code: 4001 }))).to.equal("You rejected the request in MetaMask.");
    });

    it("reports network errors and a rejected request even when a revert name is nearby", function () {
      expect(quietly(() => friendlyError({ code: "NETWORK_ERROR" }))).to.match(/Network problem/);
      // Rejection wins over anything else in the message.
      expect(
        quietly(() => friendlyError({ code: "ACTION_REJECTED", shortMessage: "InsufficientBalance" }))
      ).to.equal("You rejected the transaction in MetaMask.");
    });
  });

  // =================================================================
  // Quote maths shown in the UI
  // =================================================================
  describe("Calculated values shown in the swap panel", function () {
    it("computes price impact from the contract's own quote (100/100 pool, 1 in)", function () {
      // quote 0.990099009900990099 -> impact = 1 - 0.990099.../1 ≈ 0.9901%
      const impact = priceImpactPpm(T(1), 990_099009900990099n, T(100), T(100));
      expect(impact).to.equal(9900n);
      expect(formatPpm(impact)).to.equal("0.9900%");
    });

    it("derives the minimum received from the tolerance in exact integers", function () {
      expect(minOutForTolerance(10_000n, 50)).to.equal(9_950n);
      expect(minOutForTolerance(990_099009900990099n, 100)).to.equal(980_198019801980198n);
    });

    it("formats rates without floating point", function () {
      expect(formatRatio(T(100), 18, T(101), 18, 6)).to.equal("0.990099");
      expect(formatRatio(99_009900990099009901n, 18, T(101), 18, 6)).to.equal("0.980296");
    });

    it("matches integer sqrt and LP/removal estimates at the edges", function () {
      expect(sqrt(2n ** 256n - 1n) ** 2n <= 2n ** 256n - 1n).to.equal(true);
      expect(estimateLpShares(T(100), T(100), 0n, 0n, 0n)).to.equal(T(100));
      expect(estimateRemoval(T(10), T(100), T(100), T(100))).to.deep.equal({ amountA: T(10), amountB: T(10) });
      expect(matchingAmount(T(1), T(100), T(100))).to.equal(T(1));
      expect(matchingAmount(T(1), 0n, T(100))).to.equal(null);
    });
  });

  // =================================================================
  // 22. Integration: reproduce and diagnose the InsufficientBalance failure
  // =================================================================
  describe("22. Integration: the Sepolia InsufficientBalance failure, end to end", function () {
    let tka;
    let tkb;
    let amm;
    let ammAddress;
    let wallet;

    beforeEach(async function () {
      [wallet] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      tka = await MockERC20.deploy("Token A", "TKA");
      tkb = await MockERC20.deploy("Token B", "TKB");
      const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
      amm = await SimpleAMM.deploy(await tka.getAddress(), await tkb.getAddress());
      ammAddress = await amm.getAddress();

      // The exact Sepolia sequence.
      await tka.mint(wallet.address, T(100));
      await tkb.mint(wallet.address, T(100));
      await tka.approve(ammAddress, T(100));
      await tkb.approve(ammAddress, T(100));
      await amm.addLiquidity(T(100), T(100));
      await tka.approve(ammAddress, T(10));
      await tkb.approve(ammAddress, T(10));
    });

    /** Read the same facts AmmView reads, from the chain. */
    async function readFacts(amountIn) {
      const [reserveIn, reserveOut] = await amm.getReserves();
      return {
        chainId: SEPOLIA,
        targetChainId: SEPOLIA,
        account: wallet.address,
        signerAddress: wallet.address,
        poolTokenIn: await amm.tokenA(),
        configuredTokenIn: await tka.getAddress(),
        amountIn,
        balance: await tka.balanceOf(wallet.address),
        allowance: await tka.allowance(wallet.address, ammAddress),
        reserveIn,
        reserveOut,
        lpBalance: await amm.balanceOf(wallet.address),
        symbolIn: "TKA",
      };
    }

    it("the pre-swap check catches it before MetaMask would open", async function () {
      const problems = preflightProblems(await readFacts(T(5)));
      expect(problems).to.have.length(1);
      expect(problems[0]).to.match(/holds 0\.0 TKA, but this swap needs 5\.0 TKA/);
      expect(problems[0]).to.match(/You own 100\.0 LP shares/);
    });

    it("the real revert decodes to the same explanation", async function () {
      let revert;
      try {
        await amm.swapAForB.staticCall(T(1));
      } catch (error) {
        revert = decodeRevert(error, amm.interface);
      }
      expect(revert?.name).to.equal("InsufficientBalance");

      const tkaAddress = await tka.getAddress();
      const text = explainRevert(revert, {
        symbolOf: (address) => (address === tkaAddress ? "TKA" : "TKB"),
        lpBalance: await amm.balanceOf(wallet.address),
      });
      expect(text).to.match(/holds 0\.0 TKA, but this swap needs 1\.0 TKA/);

      // And the generic error mapper no longer hides it behind "the contract rejected this call".
      const generic = await amm.swapAForB(T(1)).catch((error) => quietly(() => friendlyError(error)));
      expect(generic).to.equal("You do not have that many tokens in your wallet.");
    });

    it("after minting 1 TKA the check passes and the quote/impact match the expected 1-TKA swap", async function () {
      await tka.mint(wallet.address, T(1));
      const facts = await readFacts(T(1));
      expect(preflightProblems(facts)).to.deep.equal([]);

      const simulated = await amm.swapAForB.staticCall(T(1));
      expect(simulated).to.equal(990_099009900990099n);
      expect(simulated).to.be.gte(minOutForTolerance(simulated, 50));
      expect(formatPpm(priceImpactPpm(T(1), simulated, facts.reserveIn, facts.reserveOut))).to.equal("0.9900%");

      await amm.swapAForB(T(1));
      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(101));
      expect(rB).to.equal(99_009900990099009901n);
    });
  });
});
