import { expect } from "chai";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 5 test suite
 * ===================================
 *
 * Part 1: MockERC20 (as LPT and RWD) + SimpleYieldFarm   — LP-token yield farming
 * Part 2: MockERC20 (as ABC and RWD) + SimpleStaking     — protocol-token staking
 *
 * The two contracts share one reward model but use the experiment sheet's own
 * vocabulary for each part (harvest/withdraw/RewardPaid/Withdrawn versus
 * claimReward/unstake/RewardClaimed/Unstaked), so the behavioural suite below
 * runs once per contract through a small name map.
 *
 * Timing is deterministic: every reward check pins the block timestamp with
 * `setNextBlockTimestamp` / `increaseTo`, so "60 seconds" is exactly 60 and the
 * expected rewards are exact integers, not approximations.
 *
 * Reward formula, recomputed independently here:
 *
 *     reward = staked * 1e15 * seconds / 1e18      (RWD base units, floor)
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;

/** 18-decimal base units, so T(100) is 100 * 10^18. */
const T = (amount) => ethers.parseUnits(String(amount), 18);

const RATE = 10n ** 15n; // 0.001 RWD per whole token per second
const PRECISION = 10n ** 18n;
const rewardFor = (staked, seconds) => (staked * RATE * BigInt(seconds)) / PRECISION;

const FLAVOURS = [
  {
    part: "Part 1 — SimpleYieldFarm (LPT)",
    contract: "SimpleYieldFarm",
    stakeToken: ["LP Token", "LPT"],
    claim: "harvest",
    withdraw: "withdraw",
    rewardEvent: "RewardPaid",
    withdrawEvent: "Withdrawn",
    noReward: "NoRewardToHarvest",
  },
  {
    part: "Part 2 — SimpleStaking (ABC)",
    contract: "SimpleStaking",
    stakeToken: ["Protocol Token", "ABC"],
    claim: "claimReward",
    withdraw: "unstake",
    rewardEvent: "RewardClaimed",
    withdrawEvent: "Unstaked",
    noReward: "NoRewardToClaim",
  },
];

for (const F of FLAVOURS) {
  describe(`VaultWise Experiment 5 — ${F.part}`, function () {
    let deployer;
    let alice;
    let bob;
    let stk; // staking token (LPT or ABC)
    let rwd;
    let pool; // SimpleYieldFarm or SimpleStaking
    let poolAddress;

    const claim = (signer) => pool.connect(signer)[F.claim]();
    const withdraw = (signer, amount) => pool.connect(signer)[F.withdraw](amount);

    /** Approve exactly `amount` and stake it; returns the stake tx's block timestamp. */
    async function approveAndStake(signer, amount) {
      await stk.connect(signer).approve(poolAddress, amount);
      const tx = await pool.connect(signer).stake(amount);
      const receipt = await tx.wait();
      return (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;
    }

    /** Send the next transaction exactly at `timestamp`. */
    const at = (timestamp) => time.setNextBlockTimestamp(timestamp);

    beforeEach(async function () {
      [deployer, alice, bob] = await ethers.getSigners();

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      stk = await MockERC20.deploy(...F.stakeToken);
      rwd = await MockERC20.deploy("Reward Token", "RWD");

      // Suggested lab values: 100 tokens to Alice (Bob gets some for multi-user tests).
      await stk.mint(alice.address, T(100));
      await stk.mint(bob.address, T(100));

      const Pool = await ethers.getContractFactory(F.contract);
      pool = await Pool.deploy(await stk.getAddress(), await rwd.getAddress());
      poolAddress = await pool.getAddress();

      // Fund the pool with RWD by minting straight to its address (sheet step 5).
      await rwd.mint(poolAddress, T(1000));
    });

    // =================================================================
    // 1. Deployment and minting
    // =================================================================
    describe("1. Token deployment, minting and wiring", function () {
      it("deploys the staking and reward tokens from MockERC20 with 18 decimals", async function () {
        expect(await stk.name()).to.equal(F.stakeToken[0]);
        expect(await stk.symbol()).to.equal(F.stakeToken[1]);
        expect(await rwd.name()).to.equal("Reward Token");
        expect(await rwd.symbol()).to.equal("RWD");
        expect(await stk.decimals()).to.equal(18n);
        expect(await rwd.decimals()).to.equal(18n);
      });

      it("mints 100 tokens to Alice and funds the pool with RWD", async function () {
        expect(await stk.balanceOf(alice.address)).to.equal(100n * 10n ** 18n);
        expect(await rwd.balanceOf(poolAddress)).to.equal(T(1000));
        expect(await pool.rewardBalance()).to.equal(T(1000));
      });

      it("restricts mint() to the token owner", async function () {
        await expect(stk.connect(alice).mint(alice.address, T(1)))
          .to.be.revertedWithCustomError(stk, "OwnableUnauthorizedAccount")
          .withArgs(alice.address);
      });

      it("stores both token addresses and the 0.001 RWD/token/s rate", async function () {
        expect(await pool.stakingToken()).to.equal(await stk.getAddress());
        expect(await pool.rewardToken()).to.equal(await rwd.getAddress());
        expect(await pool.rewardRate()).to.equal(10n ** 15n);
        expect(await pool.REWARD_PRECISION()).to.equal(10n ** 18n);
        expect(await pool.totalStaked()).to.equal(0n);
      });

      it("rejects a zero, identical, non-contract or non-18-decimal token", async function () {
        const Pool = await ethers.getContractFactory(F.contract);
        const s = await stk.getAddress();
        const r = await rwd.getAddress();

        await expect(Pool.deploy(ethers.ZeroAddress, r)).to.be.revertedWithCustomError(pool, "ZeroAddress");
        await expect(Pool.deploy(s, s)).to.be.revertedWithCustomError(pool, "IdenticalTokens");
        await expect(Pool.deploy(s, alice.address))
          .to.be.revertedWithCustomError(pool, "NotAContract")
          .withArgs(alice.address);

        const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
        const usdcAddress = await usdc.getAddress();
        await expect(Pool.deploy(usdcAddress, r))
          .to.be.revertedWithCustomError(pool, "UnsupportedDecimals")
          .withArgs(usdcAddress, 6);
      });
    });

    // =================================================================
    // 2. Approval and staking
    // =================================================================
    describe("2. Approval and staking", function () {
      it("pulls approved tokens, records the stake and emits Staked", async function () {
        await expect(stk.connect(alice).approve(poolAddress, T(100)))
          .to.emit(stk, "Approval")
          .withArgs(alice.address, poolAddress, T(100));
        expect(await stk.allowance(alice.address, poolAddress)).to.equal(T(100));

        const tx = pool.connect(alice).stake(T(100));
        await expect(tx).to.emit(pool, "Staked").withArgs(alice.address, T(100));
        await expect(tx).to.emit(stk, "Transfer").withArgs(alice.address, poolAddress, T(100));

        const block = await ethers.provider.getBlock("latest");
        expect(await pool.stakedBalance(alice.address)).to.equal(T(100));
        expect(await pool.totalStaked()).to.equal(T(100));
        expect(await pool.lastUpdate(alice.address)).to.equal(BigInt(block.timestamp));
        expect(await pool.pendingReward(alice.address)).to.equal(0n);
        expect(await stk.balanceOf(alice.address)).to.equal(0n);
        expect(await stk.balanceOf(poolAddress)).to.equal(T(100));
        expect(await stk.allowance(alice.address, poolAddress)).to.equal(0n);
      });

      it("tracks several users independently", async function () {
        await approveAndStake(alice, T(100));
        await approveAndStake(bob, T(50));
        expect(await pool.stakedBalance(alice.address)).to.equal(T(100));
        expect(await pool.stakedBalance(bob.address)).to.equal(T(50));
        expect(await pool.totalStaked()).to.equal(T(150));
      });
    });

    // =================================================================
    // 3. Reward accrual
    // =================================================================
    describe("3. Reward accrual over time", function () {
      it("earns exactly 6 RWD for 100 tokens over 60 s (the sheet's example)", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await time.increaseTo(t0 + 60);
        expect(await pool.earned(alice.address)).to.equal(T(6));
        expect(await pool.earned(alice.address)).to.equal(rewardFor(T(100), 60));
      });

      it("accrues linearly: 0.1 RWD per second for 100 tokens", async function () {
        const t0 = await approveAndStake(alice, T(100));
        for (const seconds of [1, 10, 37, 120]) {
          await time.increaseTo(t0 + seconds);
          expect(await pool.earned(alice.address)).to.equal(T(0.1) * BigInt(seconds));
        }
      });

      it("earns nothing without a stake, and only from the stake time onward", async function () {
        expect(await pool.earned(alice.address)).to.equal(0n);
        await time.increase(1000);
        const t0 = await approveAndStake(alice, T(100));
        await time.increaseTo(t0 + 5);
        expect(await pool.earned(alice.address)).to.equal(T(0.5));
      });

      it("rounds down in integer base units, never up", async function () {
        // 1 base unit staked for 999 s: 1 * 1e15 * 999 / 1e18 = 0.999 -> 0.
        await stk.connect(alice).approve(poolAddress, 1n);
        await pool.connect(alice).stake(1n);
        const t0 = Number(await pool.lastUpdate(alice.address));
        await time.increaseTo(t0 + 999);
        expect(await pool.earned(alice.address)).to.equal(0n);
        await time.increaseTo(t0 + 1000);
        expect(await pool.earned(alice.address)).to.equal(1n);

        // An odd amount matches the floor formula exactly.
        const odd = 123_456_789_012_345_678n;
        const t1 = await approveAndStake(bob, odd);
        await time.increaseTo(t1 + 77);
        expect(await pool.earned(bob.address)).to.equal(rewardFor(odd, 77));
      });
    });

    // =================================================================
    // 4. Harvesting / claiming
    // =================================================================
    describe(`4. ${F.claim}()`, function () {
      it("pays the accrued RWD, emits the reward event and restarts the clock", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 60);
        const tx = claim(alice);
        await expect(tx).to.emit(pool, F.rewardEvent).withArgs(alice.address, T(6));
        await expect(tx).to.emit(rwd, "Transfer").withArgs(poolAddress, alice.address, T(6));

        expect(await rwd.balanceOf(alice.address)).to.equal(T(6));
        expect(await rwd.balanceOf(poolAddress)).to.equal(T(994));
        expect(await pool.pendingReward(alice.address)).to.equal(0n);
        expect(await pool.lastUpdate(alice.address)).to.equal(BigInt(t0 + 60));
        expect(await pool.earned(alice.address)).to.equal(0n);
        // Claiming does not touch the stake.
        expect(await pool.stakedBalance(alice.address)).to.equal(T(100));
      });

      it("reverts when nothing has accrued", async function () {
        await expect(claim(alice)).to.be.revertedWithCustomError(pool, F.noReward);
      });

      it("never double-pays: a second claim only pays the time since the first", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 60);
        await claim(alice);
        await at(t0 + 70);
        await expect(claim(alice)).to.emit(pool, F.rewardEvent).withArgs(alice.address, T(1));
        expect(await rwd.balanceOf(alice.address)).to.equal(T(7));
      });
    });

    // =================================================================
    // 5. Partial withdrawal / unstaking
    // =================================================================
    describe(`5. Partial ${F.withdraw}()`, function () {
      it("returns 40 of 100 tokens, leaves 60 staked and keeps rewards pending", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 60);
        const tx = withdraw(alice, T(40));
        await expect(tx).to.emit(pool, F.withdrawEvent).withArgs(alice.address, T(40));
        await expect(tx).to.emit(stk, "Transfer").withArgs(poolAddress, alice.address, T(40));
        await expect(tx).to.not.emit(pool, F.rewardEvent);

        expect(await stk.balanceOf(alice.address)).to.equal(T(40));
        expect(await pool.stakedBalance(alice.address)).to.equal(T(60));
        expect(await pool.totalStaked()).to.equal(T(60));
        // The 6 RWD earned on 100 tokens is preserved, not paid and not lost.
        expect(await pool.pendingReward(alice.address)).to.equal(T(6));
        expect(await rwd.balanceOf(alice.address)).to.equal(0n);
      });

      it("accrues at the reduced rate afterwards", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 60);
        await withdraw(alice, T(40));
        await time.increaseTo(t0 + 120);
        // 6 (100 tokens x 60 s) + 3.6 (60 tokens x 60 s)
        expect(await pool.earned(alice.address)).to.equal(T(6) + T(3.6));
      });
    });

    // =================================================================
    // 6. Full exit
    // =================================================================
    describe("6. exit()", function () {
      it("returns the whole stake and pays every pending reward", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 60);
        await withdraw(alice, T(40));
        await at(t0 + 120);
        const tx = pool.connect(alice).exit();
        await expect(tx).to.emit(pool, F.withdrawEvent).withArgs(alice.address, T(60));
        await expect(tx).to.emit(pool, F.rewardEvent).withArgs(alice.address, T(9.6));

        expect(await stk.balanceOf(alice.address)).to.equal(T(100));
        expect(await rwd.balanceOf(alice.address)).to.equal(T(9.6));
        expect(await pool.stakedBalance(alice.address)).to.equal(0n);
        expect(await pool.pendingReward(alice.address)).to.equal(0n);
        expect(await pool.totalStaked()).to.equal(0n);
        expect(await pool.earned(alice.address)).to.equal(0n);
      });

      it("claims a leftover reward when the stake was already fully withdrawn", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 30);
        await withdraw(alice, T(100));
        const tx = pool.connect(alice).exit();
        await expect(tx).to.emit(pool, F.rewardEvent).withArgs(alice.address, T(3));
        await expect(tx).to.not.emit(pool, F.withdrawEvent);
      });

      it("reverts with NothingToExit when there is no stake and no reward", async function () {
        await expect(pool.connect(alice).exit()).to.be.revertedWithCustomError(pool, "NothingToExit");
      });
    });

    // =================================================================
    // 7–9. Validation
    // =================================================================
    describe("7. Zero-value rejection", function () {
      it("rejects stake(0) and a zero withdrawal", async function () {
        await expect(pool.connect(alice).stake(0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
        await approveAndStake(alice, T(10));
        await expect(withdraw(alice, 0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
      });
    });

    describe("8. Insufficient balance and allowance", function () {
      it("rejects staking more than the wallet holds, with the real numbers", async function () {
        await stk.connect(alice).approve(poolAddress, T(500));
        await expect(pool.connect(alice).stake(T(101)))
          .to.be.revertedWithCustomError(pool, "InsufficientBalance")
          .withArgs(T(100), T(101));
      });

      it("rejects staking without approval or above the allowance", async function () {
        await expect(pool.connect(alice).stake(T(10)))
          .to.be.revertedWithCustomError(pool, "InsufficientAllowance")
          .withArgs(0n, T(10));
        await stk.connect(alice).approve(poolAddress, T(5));
        await expect(pool.connect(alice).stake(T(10)))
          .to.be.revertedWithCustomError(pool, "InsufficientAllowance")
          .withArgs(T(5), T(10));
        expect(await pool.stakedBalance(alice.address)).to.equal(0n);
      });
    });

    describe("9. Excessive withdrawal", function () {
      it("rejects withdrawing more than the recorded stake", async function () {
        await approveAndStake(alice, T(60));
        await expect(withdraw(alice, T(61)))
          .to.be.revertedWithCustomError(pool, "InsufficientStakedBalance")
          .withArgs(T(60), T(61));
        await expect(withdraw(bob, 1n))
          .to.be.revertedWithCustomError(pool, "InsufficientStakedBalance")
          .withArgs(0n, 1n);
      });

      it("cannot withdraw another user's stake", async function () {
        await approveAndStake(alice, T(100));
        await approveAndStake(bob, T(10));
        await expect(withdraw(bob, T(11))).to.be.revertedWithCustomError(pool, "InsufficientStakedBalance");
        expect(await stk.balanceOf(poolAddress)).to.equal(T(110));
      });
    });

    // =================================================================
    // 10. Reward funding
    // =================================================================
    describe("10. Insufficient reward funding", function () {
      let unfunded;
      let unfundedAddress;

      beforeEach(async function () {
        const Pool = await ethers.getContractFactory(F.contract);
        unfunded = await Pool.deploy(await stk.getAddress(), await rwd.getAddress());
        unfundedAddress = await unfunded.getAddress();
        await stk.connect(alice).approve(unfundedAddress, T(100));
      });

      it("refuses to pay more than it holds and keeps the reward pending", async function () {
        await unfunded.connect(alice).stake(T(100));
        const t0 = Number(await unfunded.lastUpdate(alice.address));

        await at(t0 + 60);
        await expect(unfunded.connect(alice)[F.claim]())
          .to.be.revertedWithCustomError(unfunded, "InsufficientRewardFunding")
          .withArgs(0n, T(6));

        // Partially funded is still not enough — no partial payouts.
        await rwd.mint(unfundedAddress, T(5));
        await at(t0 + 70);
        await expect(unfunded.connect(alice)[F.claim]())
          .to.be.revertedWithCustomError(unfunded, "InsufficientRewardFunding")
          .withArgs(T(5), T(7));
        expect(await rwd.balanceOf(alice.address)).to.equal(0n);

        // Once funded, the full accrued amount is paid; nothing was lost.
        await rwd.mint(unfundedAddress, T(100));
        await at(t0 + 80);
        await expect(unfunded.connect(alice)[F.claim]())
          .to.emit(unfunded, F.rewardEvent)
          .withArgs(alice.address, T(8));
      });

      it("still lets the user recover the stake, and exit() is all-or-nothing", async function () {
        await unfunded.connect(alice).stake(T(100));
        const t0 = Number(await unfunded.lastUpdate(alice.address));

        await at(t0 + 60);
        await expect(unfunded.connect(alice).exit())
          .to.be.revertedWithCustomError(unfunded, "InsufficientRewardFunding")
          .withArgs(0n, T(6));
        expect(await unfunded.stakedBalance(alice.address)).to.equal(T(100));
        expect(await stk.balanceOf(alice.address)).to.equal(0n);

        await at(t0 + 61);
        await unfunded.connect(alice)[F.withdraw](T(100));
        expect(await stk.balanceOf(alice.address)).to.equal(T(100));
        expect(await unfunded.pendingReward(alice.address)).to.equal(T(6.1));
      });

      it("pays users first come, first served from the shared balance", async function () {
        await rwd.mint(unfundedAddress, T(6));
        await unfunded.connect(alice).stake(T(100));
        await stk.connect(bob).approve(unfundedAddress, T(100));
        await unfunded.connect(bob).stake(T(100));
        const tA = Number(await unfunded.lastUpdate(alice.address));
        const tB = Number(await unfunded.lastUpdate(bob.address));

        await at(tA + 60);
        await unfunded.connect(alice)[F.claim](); // 6 RWD, drains the pool
        await at(tA + 61);
        await expect(unfunded.connect(bob)[F.claim]())
          .to.be.revertedWithCustomError(unfunded, "InsufficientRewardFunding")
          .withArgs(0n, rewardFor(T(100), tA + 61 - tB));
      });
    });

    // =================================================================
    // 11. Reward preservation across stake changes
    // =================================================================
    describe("11. Reward preservation across stake changes", function () {
      it("an additional stake checkpoints the old balance first", async function () {
        const t0 = await approveAndStake(alice, T(50));
        await stk.connect(alice).approve(poolAddress, T(50));
        await at(t0 + 60);
        await pool.connect(alice).stake(T(50));
        expect(await pool.pendingReward(alice.address)).to.equal(T(3)); // 50 x 0.001 x 60

        await time.increaseTo(t0 + 120);
        // 3 + 100 x 0.001 x 60 = 9 — NOT 100 x 0.001 x 120 = 12, which a
        // contract that forgot to checkpoint would report.
        expect(await pool.earned(alice.address)).to.equal(T(9));
      });

      it("keeps rewards across stake → withdraw → stake → claim", async function () {
        const t0 = await approveAndStake(alice, T(100));
        await at(t0 + 10);
        await withdraw(alice, T(80)); // +1.0 (100 x 10 s)
        await stk.connect(alice).approve(poolAddress, T(30));
        await at(t0 + 30);
        await pool.connect(alice).stake(T(30)); // +0.4 (20 x 20 s)
        await at(t0 + 50);
        // +1.0 (50 x 20 s)  ->  1.0 + 0.4 + 1.0 = 2.4
        await expect(claim(alice)).to.emit(pool, F.rewardEvent).withArgs(alice.address, T(2.4));
      });

      it("one user's actions never change another's reward", async function () {
        const tA = await approveAndStake(alice, T(100));
        await stk.connect(bob).approve(poolAddress, T(100));
        await at(tA + 20);
        await pool.connect(bob).stake(T(100));
        await at(tA + 40);
        await pool.connect(bob)[F.withdraw](T(100));
        await time.increaseTo(tA + 60);
        expect(await pool.earned(alice.address)).to.equal(T(6));
        expect(await pool.earned(bob.address)).to.equal(T(2));
      });
    });

    // =================================================================
    // 12. Reentrancy and token-transfer edge cases
    // =================================================================
    describe("12. Reentrancy and token-transfer edge cases", function () {
      let host;
      let hostAddress;
      const deployWith = async (stakingAddress, rewardAddress) =>
        (await ethers.getContractFactory(F.contract)).deploy(stakingAddress, rewardAddress);

      beforeEach(async function () {
        host = await (await ethers.getContractFactory("HostileERC20")).deploy();
        hostAddress = await host.getAddress();
      });

      it("blocks a staking token that re-enters during stake()", async function () {
        const p = await deployWith(hostAddress, await rwd.getAddress());
        const pAddress = await p.getAddress();
        await host.mint(alice.address, T(100));
        await host.connect(alice).approve(pAddress, T(100));
        await host.setReenter(pAddress, p.interface.encodeFunctionData(F.withdraw, [1n]));

        await expect(p.connect(alice).stake(T(10))).to.be.revertedWithCustomError(
          p,
          "ReentrancyGuardReentrantCall"
        );
        expect(await p.stakedBalance(alice.address)).to.equal(0n);
        expect(await host.balanceOf(alice.address)).to.equal(T(100));
      });

      it(`blocks a reward token that re-enters during ${F.claim}()`, async function () {
        const p = await deployWith(await stk.getAddress(), hostAddress);
        const pAddress = await p.getAddress();
        await host.mint(pAddress, T(1000));
        await stk.connect(alice).approve(pAddress, T(100));
        await p.connect(alice).stake(T(100));
        const t0 = Number(await p.lastUpdate(alice.address));

        await host.setReenter(pAddress, p.interface.encodeFunctionData(F.claim));
        await at(t0 + 60);
        await expect(p.connect(alice)[F.claim]()).to.be.revertedWithCustomError(
          p,
          "ReentrancyGuardReentrantCall"
        );
        // The failed payout left the reward intact for a later claim. (A
        // reverted call is never mined, so the re-entry must be disarmed by hand.)
        await host.disarm();
        await at(t0 + 61);
        await expect(p.connect(alice)[F.claim]()).to.emit(p, F.rewardEvent).withArgs(alice.address, T(6.1));
      });

      it("rejects a fee-on-transfer staking token instead of over-crediting", async function () {
        const p = await deployWith(hostAddress, await rwd.getAddress());
        const pAddress = await p.getAddress();
        await host.mint(alice.address, T(100));
        await host.connect(alice).approve(pAddress, T(100));
        await host.setFee(100); // 1 %

        await expect(p.connect(alice).stake(T(100)))
          .to.be.revertedWithCustomError(p, "TransferAmountMismatch")
          .withArgs(T(100), T(99));
        expect(await p.stakedBalance(alice.address)).to.equal(0n);
        expect(await p.totalStaked()).to.equal(0n);
      });

      it("treats a token that returns false as a failed transfer (SafeERC20)", async function () {
        const p = await deployWith(hostAddress, await rwd.getAddress());
        const pAddress = await p.getAddress();
        await host.mint(alice.address, T(100));
        await host.connect(alice).approve(pAddress, T(100));
        await host.setReturnFalse();

        await expect(p.connect(alice).stake(T(10)))
          .to.be.revertedWithCustomError(p, "SafeERC20FailedOperation")
          .withArgs(hostAddress);
        expect(await p.stakedBalance(alice.address)).to.equal(0n);
      });

      it("keeps the reward pending when the reward token's transfer returns false", async function () {
        const p = await deployWith(await stk.getAddress(), hostAddress);
        const pAddress = await p.getAddress();
        await host.mint(pAddress, T(1000));
        await stk.connect(alice).approve(pAddress, T(100));
        await p.connect(alice).stake(T(100));
        const t0 = Number(await p.lastUpdate(alice.address));
        await host.setReturnFalse();

        await at(t0 + 60);
        await expect(p.connect(alice)[F.claim]()).to.be.revertedWithCustomError(p, "SafeERC20FailedOperation");
        expect(await p.pendingReward(alice.address)).to.equal(0n); // nothing was zeroed or paid
        await time.increaseTo(t0 + 100);
        expect(await p.earned(alice.address)).to.equal(T(10));
        expect(await host.balanceOf(alice.address)).to.equal(0n);
      });

      it("ignores staking tokens sent with a plain transfer", async function () {
        await stk.connect(bob).transfer(poolAddress, T(25));
        expect(await pool.totalStaked()).to.equal(0n);
        expect(await pool.stakedBalance(bob.address)).to.equal(0n);
        await expect(withdraw(bob, T(25))).to.be.revertedWithCustomError(pool, "InsufficientStakedBalance");
      });
    });
  });
}

// =====================================================================
// 13. The experiment sheet's interaction sequences, end to end
// =====================================================================
describe("VaultWise Experiment 5 — the sheet's demonstration sequences", function () {
  for (const F of FLAVOURS) {
    const sym = F.stakeToken[1];

    it(`${F.contract}: 100 ${sym} → stake → 60 s → ${F.claim} → 60 s → ${F.withdraw} 40 → 60 s → exit`, async function () {
      const [, alice] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");

      // 1–2. Deploy MockERC20 twice.
      const stk = await MockERC20.deploy(...F.stakeToken);
      const rwd = await MockERC20.deploy("Reward Token", "RWD");
      // 3. Mint 100 to Alice.
      await stk.mint(alice.address, T(100));
      // 4. Deploy the pool with both addresses.
      const pool = await (await ethers.getContractFactory(F.contract)).deploy(
        await stk.getAddress(),
        await rwd.getAddress()
      );
      const poolAddress = await pool.getAddress();
      // 5. Fund it with RWD.
      await rwd.mint(poolAddress, T(1000));
      // 6–7. Approve and stake 100.
      await stk.connect(alice).approve(poolAddress, T(100));
      await pool.connect(alice).stake(T(100));
      const t0 = Number(await pool.lastUpdate(alice.address));
      // 8. Verify stakedBalance.
      expect(await pool.stakedBalance(alice.address)).to.equal(T(100));
      // 9. Wait 60 s, observe earned().
      await time.increaseTo(t0 + 60);
      expect(await pool.earned(alice.address)).to.equal(T(6));
      // 10. Harvest/claim at t0+61 (one more second passes while mining).
      await time.setNextBlockTimestamp(t0 + 61);
      await pool.connect(alice)[F.claim]();
      expect(await rwd.balanceOf(alice.address)).to.equal(T(6.1));
      // 11. Wait again, partial withdrawal of 40.
      await time.setNextBlockTimestamp(t0 + 121);
      await pool.connect(alice)[F.withdraw](T(40));
      // 12. Verify balances: 40 back in the wallet, 60 still staked.
      expect(await stk.balanceOf(alice.address)).to.equal(T(40));
      expect(await pool.stakedBalance(alice.address)).to.equal(T(60));
      expect(await pool.pendingReward(alice.address)).to.equal(T(6));
      // 13. exit(): remaining 60 back and every pending reward paid.
      await time.setNextBlockTimestamp(t0 + 181);
      await pool.connect(alice).exit();
      expect(await stk.balanceOf(alice.address)).to.equal(T(100));
      expect(await pool.stakedBalance(alice.address)).to.equal(0n);
      // 6.1 + 6 (100 x 60 s) + 3.6 (60 x 60 s) = 15.7
      expect(await rwd.balanceOf(alice.address)).to.equal(T(15.7));
      expect(await rwd.balanceOf(poolAddress)).to.equal(T(1000) - T(15.7));
    });
  }
});
