import { expect } from "chai";
import { network } from "hardhat";

import { inspect } from "../scripts/lib/experiment5State.js";
import { deployConfirmed, sendConfirmed, waitForIdle } from "../scripts/lib/txSafety.js";

/**
 * VaultWise — Experiment 5 partial-deployment recovery
 * ====================================================
 *
 * Reproduces the Sepolia failure locally — steps 1–7 done, step 8 (mint 100
 * ABC) rejected — and checks that the state inspection used by
 * checkExperiment5.js / resumeExperiment5.js reports exactly steps 8–10 as
 * remaining, detects duplicates and inconsistencies, and that the safe sender
 * retries the "in-flight transaction limit" rejection only when nothing was sent.
 */

const { ethers } = await network.getOrCreate();
const T = (whole) => ethers.parseUnits(String(whole), 18);
const quiet = () => {};

describe("VaultWise Experiment 5 — partial deployment recovery", function () {
  let deployer;
  let other;
  let record;
  let chainId;
  let abc;
  let rwd2;

  /** Steps 1–7 of deployExperiment5.js, recorded the way it records them. */
  beforeEach(async function () {
    [deployer, other] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const entry = async (c, name, symbol) => ({ address: await c.getAddress(), txHash: c.deploymentTransaction().hash, name, symbol });

    const lpt = await MockERC20.deploy("LP Token", "LPT");
    const rwd1 = await MockERC20.deploy("Reward Token", "RWD");
    await lpt.mint(deployer.address, T(100));
    const farm = await (await ethers.getContractFactory("SimpleYieldFarm")).deploy(await lpt.getAddress(), await rwd1.getAddress());
    await rwd1.mint(await farm.getAddress(), T(1000));
    abc = await MockERC20.deploy("Protocol Token", "ABC");
    rwd2 = await MockERC20.deploy("Reward Token", "RWD");

    record = {
      deployer: deployer.address,
      status: "partial",
      yieldFarming: {
        LPT: await entry(lpt, "LP Token", "LPT"),
        RWD: await entry(rwd1, "Reward Token", "RWD"),
        SimpleYieldFarm: { address: await farm.getAddress(), txHash: farm.deploymentTransaction().hash },
      },
      staking: { ABC: await entry(abc, "Protocol Token", "ABC"), RWD: await entry(rwd2, "Reward Token", "RWD") },
    };
  });

  const stepsDone = (report) => report.steps.filter((s) => s.done).map((s) => s.n);

  it("reports steps 1–7 verified and exactly 8, 9, 10 remaining", async function () {
    const report = await inspect(ethers.provider, record, { chainId });
    expect(report.problems).to.deep.equal([]);
    expect(stepsDone(report)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
  });

  it("skips step 8 if the ABC mint actually went through", async function () {
    await abc.mint(deployer.address, T(100));
    const report = await inspect(ethers.provider, record, { chainId });
    expect(stepsDone(report)).to.include(8);
    expect(report.ok).to.equal(true);
  });

  it("finds an unrecorded SimpleStaking instead of deploying a second one", async function () {
    const staking = await (await ethers.getContractFactory("SimpleStaking")).deploy(await abc.getAddress(), await rwd2.getAddress());
    const report = await inspect(ethers.provider, record, { chainId });
    expect(report.facts.stakingAddress).to.equal(await staking.getAddress());
    expect(stepsDone(report)).to.include(9);
  });

  it("refuses when there are two candidate SimpleStaking contracts", async function () {
    const Staking = await ethers.getContractFactory("SimpleStaking");
    await Staking.deploy(await abc.getAddress(), await rwd2.getAddress());
    await Staking.deploy(await abc.getAddress(), await rwd2.getAddress());
    const report = await inspect(ethers.provider, record, { chainId });
    expect(report.ok).to.equal(false);
    expect(report.problems.join()).to.include("more than one SimpleStaking");
  });

  it("flags a wrong address, a wrong token, and ABC minted to someone else", async function () {
    const wrong = structuredClone(record);
    wrong.yieldFarming.LPT.address = wrong.staking.ABC.address; // ABC recorded as LPT
    let report = await inspect(ethers.provider, wrong, { chainId });
    expect(report.problems.join()).to.include("LPT (MockERC20) metadata");

    await abc.mint(other.address, T(100));
    report = await inspect(ethers.provider, record, { chainId });
    expect(report.problems.join()).to.include("ABC state");
    expect(stepsDone(report)).to.not.include(8);
  });

  it("checks the recorded deployment receipts", async function () {
    const bad = structuredClone(record);
    bad.staking.ABC.txHash = bad.staking.RWD.txHash; // receipt created a different contract
    const report = await inspect(ethers.provider, bad, { chainId });
    expect(report.problems.join()).to.include("ABC (MockERC20) deploy receipt");
  });

  describe("safe sending", function () {
    it("retries the in-flight rejection only when nothing was sent, then confirms", async function () {
      let calls = 0;
      const { receipt } = await sendConfirmed({
        label: "mint",
        provider: ethers.provider,
        from: deployer.address,
        retryDelayMs: 1,
        log: quiet,
        send: async () => {
          calls += 1;
          if (calls === 1) throw new Error("in-flight transaction limit reached for delegated accounts");
          return abc.mint(deployer.address, T(100));
        },
      });
      expect(calls).to.equal(2);
      expect(receipt.status).to.equal(1);
      expect(await abc.balanceOf(deployer.address)).to.equal(T(100)); // minted once, not twice
    });

    it("does not retry other errors, and surfaces a reverted transaction", async function () {
      await expect(
        sendConfirmed({ label: "x", provider: ethers.provider, from: deployer.address, log: quiet, send: async () => { throw new Error("boom"); } })
      ).to.be.rejectedWith("boom");
      await expect(
        sendConfirmed({ label: "x", provider: ethers.provider, from: other.address, log: quiet, send: () => abc.connect(other).mint(other.address, 1n) })
      ).to.be.rejected; // not the owner: reverts
    });

    it("deployConfirmed takes the address from the receipt and checks it is the CREATE address", async function () {
      const deployed = await deployConfirmed({
        label: "deploy SimpleStaking",
        factory: await ethers.getContractFactory("SimpleStaking"),
        args: [await abc.getAddress(), await rwd2.getAddress()],
        provider: ethers.provider,
        from: deployer.address,
        getCreateAddress: ethers.getCreateAddress,
        log: quiet,
      });
      expect(await deployed.contract.stakingToken()).to.equal(await abc.getAddress());
      expect(await waitForIdle(ethers.provider, deployer.address, { log: quiet })).to.be.a("number");
    });
  });
});
