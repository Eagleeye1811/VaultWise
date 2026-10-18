import { expect } from "chai";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 4 test suite
 * ===================================
 *
 * MockERC20 (deployed twice, as TKA and TKB) + SimpleAMM, a no-fee
 * constant-product pool whose LP shares are its own ERC-20 (vwLP).
 *
 * Numbers used throughout (all tokens 18 decimals):
 *
 *   provider and trader each start with 10 000 TKA and 10 000 TKB
 *   initial liquidity: 1 000 TKA + 4 000 TKB  ->  sqrt(1000 * 4000) = 2 000 vwLP
 *
 * Every expected swap output is recomputed independently here with BigInt
 * arithmetic, so the tests check the contract against the formula rather than
 * against itself.
 */

const { ethers } = await network.getOrCreate();

/** 18-decimal base units, so T(1000) is 1000 * 10^18. */
const T = (amount) => ethers.parseUnits(String(amount), 18);

const ceilDiv = (a, b) => (a + b - 1n) / b;

/** The swap formula from the experiment sheet, with the contract's ceil rounding. */
const quote = (amountIn, reserveIn, reserveOut) =>
  reserveOut - ceilDiv(reserveIn * reserveOut, reserveIn + amountIn);

/** The sheet's formula exactly as written (floor division). */
const quoteFloor = (amountIn, reserveIn, reserveOut) =>
  reserveOut - (reserveIn * reserveOut) / (reserveIn + amountIn);

describe("VaultWise Experiment 4 — MockERC20 + SimpleAMM", function () {
  let tka;
  let tkb;
  let amm;
  let ammAddress;
  let deployer;
  let provider; // first liquidity provider
  let trader; // swaps, and second liquidity provider

  beforeEach(async function () {
    [deployer, provider, trader] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tka = await MockERC20.deploy("Token A", "TKA");
    tkb = await MockERC20.deploy("Token B", "TKB");

    for (const account of [provider, trader]) {
      await tka.mint(account.address, T(10_000));
      await tkb.mint(account.address, T(10_000));
    }

    const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
    amm = await SimpleAMM.deploy(await tka.getAddress(), await tkb.getAddress());
    ammAddress = await amm.getAddress();
  });

  /** Approve exactly the amounts and add liquidity. */
  async function addLiquidityAs(signer, amountA, amountB) {
    await tka.connect(signer).approve(ammAddress, amountA);
    await tkb.connect(signer).approve(ammAddress, amountB);
    return amm.connect(signer).addLiquidity(amountA, amountB);
  }

  /** Seed the pool with the standard 1 000 TKA / 4 000 TKB position. */
  const seedPool = () => addLiquidityAs(provider, T(1000), T(4000));

  /** Everything a failed transaction must leave untouched. */
  async function snapshot() {
    const [rA, rB] = await amm.getReserves();
    return {
      rA,
      rB,
      supply: await amm.totalSupply(),
      poolA: await tka.balanceOf(ammAddress),
      poolB: await tkb.balanceOf(ammAddress),
      providerA: await tka.balanceOf(provider.address),
      providerB: await tkb.balanceOf(provider.address),
      providerLP: await amm.balanceOf(provider.address),
      traderA: await tka.balanceOf(trader.address),
      traderB: await tkb.balanceOf(trader.address),
      traderLP: await amm.balanceOf(trader.address),
    };
  }

  /** Recorded reserves must always equal what the pool actually holds. */
  async function expectReservesMatchBalances() {
    const [rA, rB] = await amm.getReserves();
    expect(await tka.balanceOf(ammAddress)).to.equal(rA);
    expect(await tkb.balanceOf(ammAddress)).to.equal(rB);
  }

  // ===================================================================
  // 1. Test tokens
  // ===================================================================
  describe("1. MockERC20 deployment and minting", function () {
    it("deploys TKA and TKB from the same contract with 18 decimals", async function () {
      expect(await tka.name()).to.equal("Token A");
      expect(await tka.symbol()).to.equal("TKA");
      expect(await tkb.name()).to.equal("Token B");
      expect(await tkb.symbol()).to.equal("TKB");
      expect(await tka.decimals()).to.equal(18n);
      expect(await tkb.decimals()).to.equal(18n);
      expect(await tka.getAddress()).to.not.equal(await tkb.getAddress());
    });

    it("mints in base units and emits Transfer from the zero address", async function () {
      expect(await tka.balanceOf(provider.address)).to.equal(10_000n * 10n ** 18n);
      expect(await tka.totalSupply()).to.equal(T(20_000));

      await expect(tkb.mint(deployer.address, T(5)))
        .to.emit(tkb, "Transfer")
        .withArgs(ethers.ZeroAddress, deployer.address, T(5));
      expect(await tkb.balanceOf(deployer.address)).to.equal(T(5));
    });

    it("restricts mint to the owner", async function () {
      expect(await tka.owner()).to.equal(deployer.address);
      await expect(
        tka.connect(provider).mint(provider.address, T(1))
      ).to.be.revertedWithCustomError(tka, "OwnableUnauthorizedAccount");
    });

    it("supports approve / allowance / transferFrom", async function () {
      await tka.connect(provider).approve(trader.address, T(10));
      expect(await tka.allowance(provider.address, trader.address)).to.equal(T(10));

      await tka.connect(trader).transferFrom(provider.address, trader.address, T(4));
      expect(await tka.balanceOf(trader.address)).to.equal(T(10_004));
      expect(await tka.allowance(provider.address, trader.address)).to.equal(T(6));
    });
  });

  // ===================================================================
  // 2. AMM deployment and constructor validation
  // ===================================================================
  describe("2. SimpleAMM deployment", function () {
    it("stores both tokens, starts empty and names the LP share", async function () {
      expect(await amm.tokenA()).to.equal(await tka.getAddress());
      expect(await amm.tokenB()).to.equal(await tkb.getAddress());
      expect(await amm.name()).to.equal("VaultWise LP");
      expect(await amm.symbol()).to.equal("vwLP");
      expect(await amm.decimals()).to.equal(18n);

      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(0n);
      expect(rB).to.equal(0n);
      expect(await amm.totalSupply()).to.equal(0n);
    });

    it("rejects a zero token address", async function () {
      const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
      await expect(
        SimpleAMM.deploy(ethers.ZeroAddress, await tkb.getAddress())
      ).to.be.revertedWithCustomError(amm, "ZeroAddress");
      await expect(
        SimpleAMM.deploy(await tka.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(amm, "ZeroAddress");
    });

    it("rejects identical token addresses", async function () {
      const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
      await expect(
        SimpleAMM.deploy(await tka.getAddress(), await tka.getAddress())
      ).to.be.revertedWithCustomError(amm, "IdenticalTokens");
    });

    it("rejects an address with no contract code", async function () {
      const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
      await expect(SimpleAMM.deploy(trader.address, await tkb.getAddress()))
        .to.be.revertedWithCustomError(amm, "NotAContract")
        .withArgs(trader.address);
    });
  });

  // ===================================================================
  // 3. First liquidity addition
  // ===================================================================
  describe("3. First addLiquidity()", function () {
    it("mints sqrt(amountA * amountB) LP shares and records reserves", async function () {
      await expect(seedPool())
        .to.emit(amm, "LiquidityAdded")
        .withArgs(provider.address, T(1000), T(4000), T(2000))
        .and.to.emit(amm, "Sync")
        .withArgs(T(1000), T(4000));

      expect(await amm.balanceOf(provider.address)).to.equal(T(2000));
      expect(await amm.totalSupply()).to.equal(T(2000));

      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(1000));
      expect(rB).to.equal(T(4000));
      await expectReservesMatchBalances();
    });

    it("moves the tokens out of the provider's wallet", async function () {
      await seedPool();
      expect(await tka.balanceOf(provider.address)).to.equal(T(9000));
      expect(await tkb.balanceOf(provider.address)).to.equal(T(6000));
      // Exact approvals are fully consumed.
      expect(await tka.allowance(provider.address, ammAddress)).to.equal(0n);
      expect(await tkb.allowance(provider.address, ammAddress)).to.equal(0n);
    });

    it("emits the LP-share mint as an ERC-20 Transfer from zero", async function () {
      await expect(seedPool())
        .to.emit(amm, "Transfer")
        .withArgs(ethers.ZeroAddress, provider.address, T(2000));
    });
  });

  // ===================================================================
  // 4. Subsequent liquidity addition
  // ===================================================================
  describe("4. Subsequent addLiquidity()", function () {
    beforeEach(seedPool);

    it("mints shares proportional to the existing pool", async function () {
      // 10% of the pool at the exact 1:4 ratio -> 10% of supply.
      await expect(addLiquidityAs(trader, T(100), T(400)))
        .to.emit(amm, "LiquidityAdded")
        .withArgs(trader.address, T(100), T(400), T(200));

      expect(await amm.balanceOf(trader.address)).to.equal(T(200));
      expect(await amm.totalSupply()).to.equal(T(2200));

      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(1100));
      expect(rB).to.equal(T(4400));
      await expectReservesMatchBalances();
    });

    it("credits an off-ratio deposit only for its matched part", async function () {
      // 100 TKA alone would earn 200 vwLP, but 100 TKB only 50 — the min wins.
      await addLiquidityAs(trader, T(100), T(100));
      expect(await amm.balanceOf(trader.address)).to.equal(T(50));

      // Both full amounts are still taken into the reserves.
      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(1100));
      expect(rB).to.equal(T(4100));
      await expectReservesMatchBalances();
    });

    it("rejects a deposit too small to mint a single LP base unit", async function () {
      // 1 wei TKA against 1000e18 reserves * 2000e18 supply -> 1*2000/1000 = 2,
      // but 1 wei TKB -> 1*2000/4000 = 0, so min = 0.
      await tka.connect(trader).approve(ammAddress, 1n);
      await tkb.connect(trader).approve(ammAddress, 1n);
      await expect(
        amm.connect(trader).addLiquidity(1n, 1n)
      ).to.be.revertedWithCustomError(amm, "InsufficientLiquidityMinted");
    });
  });

  // ===================================================================
  // 5. Zero-value liquidity additions
  // ===================================================================
  describe("5. Zero-value addLiquidity()", function () {
    it("rejects zero Token A, zero Token B and both zero", async function () {
      await tka.connect(provider).approve(ammAddress, T(10));
      await tkb.connect(provider).approve(ammAddress, T(10));

      for (const [a, b] of [
        [0n, T(10)],
        [T(10), 0n],
        [0n, 0n],
      ]) {
        await expect(
          amm.connect(provider).addLiquidity(a, b)
        ).to.be.revertedWithCustomError(amm, "ZeroAmount");
      }
      expect(await amm.totalSupply()).to.equal(0n);
    });
  });

  // ===================================================================
  // 6. Removing liquidity
  // ===================================================================
  describe("6. removeLiquidity()", function () {
    beforeEach(seedPool);

    it("burns shares and returns the proportional part of both reserves", async function () {
      // 25% of supply -> 25% of each reserve.
      await expect(amm.connect(provider).removeLiquidity(T(500)))
        .to.emit(amm, "LiquidityRemoved")
        .withArgs(provider.address, T(250), T(1000), T(500))
        .and.to.emit(amm, "Sync")
        .withArgs(T(750), T(3000))
        .and.to.emit(amm, "Transfer")
        .withArgs(provider.address, ethers.ZeroAddress, T(500));

      expect(await amm.balanceOf(provider.address)).to.equal(T(1500));
      expect(await amm.totalSupply()).to.equal(T(1500));
      expect(await tka.balanceOf(provider.address)).to.equal(T(9250));
      expect(await tkb.balanceOf(provider.address)).to.equal(T(7000));
      await expectReservesMatchBalances();
    });

    it("returns everything and empties the pool when all shares are burned", async function () {
      await amm.connect(provider).removeLiquidity(T(2000));

      expect(await amm.totalSupply()).to.equal(0n);
      expect(await amm.balanceOf(provider.address)).to.equal(0n);
      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(0n);
      expect(rB).to.equal(0n);
      expect(await tka.balanceOf(provider.address)).to.equal(T(10_000));
      expect(await tkb.balanceOf(provider.address)).to.equal(T(10_000));
      await expectReservesMatchBalances();
    });

    it("lets a fresh first provider re-seed an emptied pool", async function () {
      await amm.connect(provider).removeLiquidity(T(2000));
      await addLiquidityAs(trader, T(9), T(16));
      expect(await amm.balanceOf(trader.address)).to.equal(T(12)); // sqrt(9*16)
    });

    it("rejects zero LP shares", async function () {
      await expect(
        amm.connect(provider).removeLiquidity(0n)
      ).to.be.revertedWithCustomError(amm, "ZeroAmount");
    });

    it("rejects a burn so small it would return zero of a token", async function () {
      // 1 wei LP of 2000e18 supply -> 1 * 1000e18 / 2000e18 = 0 TKA.
      await expect(
        amm.connect(provider).removeLiquidity(1n)
      ).to.be.revertedWithCustomError(amm, "InsufficientOutputAmount");
    });
  });

  // ===================================================================
  // 7. Removing more than owned
  // ===================================================================
  describe("7. removeLiquidity() beyond the caller's balance", function () {
    beforeEach(seedPool);

    it("rejects removing more LP shares than owned", async function () {
      await expect(amm.connect(provider).removeLiquidity(T(2000) + 1n))
        .to.be.revertedWithCustomError(amm, "InsufficientLPBalance")
        .withArgs(T(2000), T(2000) + 1n);
    });

    it("rejects an account with no shares at all", async function () {
      await expect(amm.connect(trader).removeLiquidity(T(1)))
        .to.be.revertedWithCustomError(amm, "InsufficientLPBalance")
        .withArgs(0n, T(1));
    });

    it("lets LP shares move as ERC-20s, and the new holder can redeem them", async function () {
      await amm.connect(provider).transfer(trader.address, T(200));
      expect(await amm.balanceOf(trader.address)).to.equal(T(200));

      await amm.connect(trader).removeLiquidity(T(200));
      expect(await tka.balanceOf(trader.address)).to.equal(T(10_100));
      expect(await tkb.balanceOf(trader.address)).to.equal(T(10_400));
    });
  });

  // ===================================================================
  // 8 & 9. Swaps in both directions
  // ===================================================================
  describe("8. swapAForB()", function () {
    beforeEach(seedPool);

    it("pays the constant-product output and updates reserves", async function () {
      const amountIn = T(100);
      const expected = quote(amountIn, T(1000), T(4000));
      // 4000 - ceil(4e42 / 1100e18) = 363.636363636363636363 TKB
      expect(expected).to.equal(363_636363636363636363n);

      expect(await amm.getAmountOut(await tka.getAddress(), amountIn)).to.equal(expected);

      await tka.connect(trader).approve(ammAddress, amountIn);
      await expect(amm.connect(trader).swapAForB(amountIn))
        .to.emit(amm, "Swap")
        .withArgs(trader.address, await tka.getAddress(), amountIn, await tkb.getAddress(), expected)
        .and.to.emit(amm, "Sync")
        .withArgs(T(1100), T(4000) - expected);

      expect(await tka.balanceOf(trader.address)).to.equal(T(9900));
      expect(await tkb.balanceOf(trader.address)).to.equal(T(10_000) + expected);

      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(1100));
      expect(rB).to.equal(T(4000) - expected);
      await expectReservesMatchBalances();

      // A swap never touches LP supply.
      expect(await amm.totalSupply()).to.equal(T(2000));
    });
  });

  describe("9. swapBForA()", function () {
    beforeEach(seedPool);

    it("pays the constant-product output and updates reserves", async function () {
      const amountIn = T(400);
      const expected = quote(amountIn, T(4000), T(1000));

      expect(await amm.getAmountOut(await tkb.getAddress(), amountIn)).to.equal(expected);

      await tkb.connect(trader).approve(ammAddress, amountIn);
      await expect(amm.connect(trader).swapBForA(amountIn))
        .to.emit(amm, "Swap")
        .withArgs(trader.address, await tkb.getAddress(), amountIn, await tka.getAddress(), expected)
        .and.to.emit(amm, "Sync")
        .withArgs(T(1000) - expected, T(4400));

      expect(await tkb.balanceOf(trader.address)).to.equal(T(9600));
      expect(await tka.balanceOf(trader.address)).to.equal(T(10_000) + expected);

      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(1000) - expected);
      expect(rB).to.equal(T(4400));
      await expectReservesMatchBalances();
    });

    it("a round trip A -> B -> A returns no more than was put in", async function () {
      await tka.connect(trader).approve(ammAddress, T(100));
      await amm.connect(trader).swapAForB(T(100));
      const gotB = (await tkb.balanceOf(trader.address)) - T(10_000);

      await tkb.connect(trader).approve(ammAddress, gotB);
      await amm.connect(trader).swapBForA(gotB);

      // No fee, so the trader gets back almost exactly 100 TKA — but rounding
      // always favours the pool, never the trader.
      const finalA = await tka.balanceOf(trader.address);
      expect(finalA).to.be.lte(T(10_000));
      expect(T(10_000) - finalA).to.be.lt(10n);
    });
  });

  // ===================================================================
  // 10. Zero-input swaps
  // ===================================================================
  describe("10. Zero-input swaps", function () {
    beforeEach(seedPool);

    it("rejects zero input in both directions and in the quote", async function () {
      await expect(amm.connect(trader).swapAForB(0n)).to.be.revertedWithCustomError(amm, "ZeroAmount");
      await expect(amm.connect(trader).swapBForA(0n)).to.be.revertedWithCustomError(amm, "ZeroAmount");
      await expect(
        amm.getAmountOut(await tka.getAddress(), 0n)
      ).to.be.revertedWithCustomError(amm, "ZeroAmount");
    });

    it("rejects quoting a token that is not in the pool", async function () {
      await expect(amm.getAmountOut(trader.address, T(1)))
        .to.be.revertedWithCustomError(amm, "InvalidToken")
        .withArgs(trader.address);
    });
  });

  // ===================================================================
  // 11. Insufficient pool liquidity
  // ===================================================================
  describe("11. Insufficient pool liquidity", function () {
    it("rejects swaps and quotes against an empty pool", async function () {
      await tka.connect(trader).approve(ammAddress, T(1));
      await tkb.connect(trader).approve(ammAddress, T(1));

      await expect(amm.connect(trader).swapAForB(T(1))).to.be.revertedWithCustomError(
        amm,
        "InsufficientLiquidity"
      );
      await expect(amm.connect(trader).swapBForA(T(1))).to.be.revertedWithCustomError(
        amm,
        "InsufficientLiquidity"
      );
      await expect(
        amm.getAmountOut(await tka.getAddress(), T(1))
      ).to.be.revertedWithCustomError(amm, "InsufficientLiquidity");
    });

    it("rejects a swap whose output rounds to zero", async function () {
      await seedPool();
      // 1 wei TKA into a 1000e18 / 4000e18 pool: ideal output is ~3.99 wei,
      // ceil rounding leaves 3. 1 wei TKB into the other side: ideal ~0.25 wei -> 0.
      await tkb.connect(trader).approve(ammAddress, 1n);
      await expect(amm.connect(trader).swapBForA(1n)).to.be.revertedWithCustomError(
        amm,
        "InsufficientOutputAmount"
      );
    });

    it("can never drain a reserve, however large the input", async function () {
      await addLiquidityAs(provider, 10n, 10n); // a tiny pool: 10 wei each side
      const huge = T(10_000);
      await tka.connect(trader).approve(ammAddress, huge);
      await amm.connect(trader).swapAForB(huge);

      const [, rB] = await amm.getReserves();
      expect(rB).to.equal(1n); // ceil(100 / (10 + huge)) = 1
      await expectReservesMatchBalances();
    });
  });

  // ===================================================================
  // 12. Insufficient allowances and balances
  // ===================================================================
  describe("12. Insufficient allowances and balances", function () {
    it("addLiquidity reverts without enough allowance on either token", async function () {
      await tka.connect(provider).approve(ammAddress, T(1000));
      await tkb.connect(provider).approve(ammAddress, T(3999)); // 1 short

      await expect(amm.connect(provider).addLiquidity(T(1000), T(4000)))
        .to.be.revertedWithCustomError(amm, "InsufficientAllowance")
        .withArgs(await tkb.getAddress(), T(3999), T(4000));
    });

    it("swap reverts without enough allowance on the input token", async function () {
      await seedPool();
      await tka.connect(trader).approve(ammAddress, T(99));
      await expect(amm.connect(trader).swapAForB(T(100)))
        .to.be.revertedWithCustomError(amm, "InsufficientAllowance")
        .withArgs(await tka.getAddress(), T(99), T(100));
    });

    it("reverts when the caller does not hold enough tokens", async function () {
      await seedPool();
      await tkb.connect(trader).approve(ammAddress, T(20_000));
      await expect(amm.connect(trader).swapBForA(T(20_000)))
        .to.be.revertedWithCustomError(amm, "InsufficientBalance")
        .withArgs(await tkb.getAddress(), T(10_000), T(20_000));
    });
  });

  // ===================================================================
  // 13 & 14. Full lifecycle: reserves, LP balances, and the invariant
  // ===================================================================
  describe("13-14. Lifecycle accounting and the constant product", function () {
    it("tracks reserves and LP balances through every step of the workflow", async function () {
      // Add initial liquidity.
      await seedPool();
      let [rA, rB] = await amm.getReserves();
      expect([rA, rB]).to.deep.equal([T(1000), T(4000)]);
      expect(await amm.balanceOf(provider.address)).to.equal(T(2000));

      // TKA -> TKB.
      const outB = quote(T(50), rA, rB);
      await tka.connect(trader).approve(ammAddress, T(50));
      await amm.connect(trader).swapAForB(T(50));
      [rA, rB] = await amm.getReserves();
      expect([rA, rB]).to.deep.equal([T(1050), T(4000) - outB]);
      await expectReservesMatchBalances();

      // TKB -> TKA.
      const outA = quote(T(200), rB, rA);
      await tkb.connect(trader).approve(ammAddress, T(200));
      await amm.connect(trader).swapBForA(T(200));
      const [rA2, rB2] = await amm.getReserves();
      expect([rA2, rB2]).to.deep.equal([rA - outA, rB + T(200)]);
      await expectReservesMatchBalances();

      // Swaps never change LP supply.
      expect(await amm.totalSupply()).to.equal(T(2000));

      // Remove half the liquidity.
      const aBefore = await tka.balanceOf(provider.address);
      const bBefore = await tkb.balanceOf(provider.address);
      await amm.connect(provider).removeLiquidity(T(1000));

      expect(await amm.balanceOf(provider.address)).to.equal(T(1000));
      expect(await tka.balanceOf(provider.address)).to.equal(aBefore + (T(1000) * rA2) / T(2000));
      expect(await tkb.balanceOf(provider.address)).to.equal(bBefore + (T(1000) * rB2) / T(2000));
      await expectReservesMatchBalances();
    });

    it("never lets k decrease, and grows it by less than newReserveIn per swap", async function () {
      await seedPool();

      const steps = [
        ["AtoB", T(100)],
        ["BtoA", T(777)],
        ["AtoB", 123_456_789n],
        ["BtoA", T(3)],
        ["AtoB", T(2500)],
      ];

      for (const [direction, amountIn] of steps) {
        const [rA, rB] = await amm.getReserves();
        const kBefore = rA * rB;

        if (direction === "AtoB") {
          await tka.connect(trader).approve(ammAddress, amountIn);
          await amm.connect(trader).swapAForB(amountIn);
        } else {
          await tkb.connect(trader).approve(ammAddress, amountIn);
          await amm.connect(trader).swapBForA(amountIn);
        }

        const [nA, nB] = await amm.getReserves();
        const kAfter = nA * nB;
        const newReserveIn = direction === "AtoB" ? nA : nB;

        expect(kAfter).to.be.gte(kBefore);
        expect(kAfter - kBefore).to.be.lt(newReserveIn);
      }
    });

    it("differs from the sheet's floor formula by at most 1 base unit", async function () {
      await seedPool();
      for (const amountIn of [1n, 7n, T(1), T(100), 123_456_789_123n, T(9999)]) {
        const onChain = await amm.getAmountOut(await tka.getAddress(), amountIn);
        const sheet = quoteFloor(amountIn, T(1000), T(4000));
        expect(sheet - onChain).to.be.oneOf([0n, 1n]);
      }
    });
  });

  // ===================================================================
  // 15. Failed transactions leave no trace
  // ===================================================================
  describe("15. Failed transactions leave state untouched", function () {
    beforeEach(seedPool);

    it("a reverted addLiquidity mints no shares and moves no tokens", async function () {
      const before = await snapshot();
      // TKA approved, TKB not — the TKA leg must not survive on its own.
      await tka.connect(trader).approve(ammAddress, T(100));
      await expect(amm.connect(trader).addLiquidity(T(100), T(400))).to.be.revertedWithCustomError(
        amm,
        "InsufficientAllowance"
      );
      expect(await snapshot()).to.deep.equal(before);
    });

    it("a reverted swap changes no reserves or balances", async function () {
      const before = await snapshot();
      await expect(amm.connect(trader).swapBForA(T(50))).to.be.revertedWithCustomError(
        amm,
        "InsufficientAllowance"
      ); // no approval
      await expect(amm.connect(trader).swapAForB(0n)).to.be.revertedWithCustomError(amm, "ZeroAmount");
      expect(await snapshot()).to.deep.equal(before);
    });

    it("a reverted removeLiquidity burns nothing", async function () {
      const before = await snapshot();
      await expect(amm.connect(provider).removeLiquidity(T(5000))).to.be.revertedWithCustomError(
        amm,
        "InsufficientLPBalance"
      );
      await expect(amm.connect(trader).removeLiquidity(T(1))).to.be.revertedWithCustomError(
        amm,
        "InsufficientLPBalance"
      );
      expect(await snapshot()).to.deep.equal(before);
    });
  });

  // ===================================================================
  // 16. Reproduction of the Sepolia InsufficientBalance failure
  // ===================================================================
  describe("16. Sepolia InsufficientBalance reproduction (100/100 pool)", function () {
    /**
     * Replays, step for step, what the Sepolia event log shows happened at
     * TKA 0x785B…7138 / TKB 0xfD6f…114b / SimpleAMM 0x14bD…6ceb:
     *
     *   block 11915067/72  mint(wallet, 100) on TKA and TKB
     *   block 11915099/102 approve(pool, 100) on both
     *   block 11915120     addLiquidity(100, 100)  -> every token the wallet had
     *   block 11915177/82  approve(pool, 10) on both
     *   then               swapAForB(5e18) / swapAForB(1e18) -> InsufficientBalance
     */
    let wallet;

    beforeEach(async function () {
      wallet = deployer; // the token owner, as on Sepolia
      await tka.mint(wallet.address, T(100));
      await tkb.mint(wallet.address, T(100));
      await addLiquidityAs(wallet, T(100), T(100));
      await tka.connect(wallet).approve(ammAddress, T(10));
      await tkb.connect(wallet).approve(ammAddress, T(10));
    });

    it("leaves the wallet with 0 TKA but 100 vwLP, a 100/100 pool, and a 10 TKA allowance", async function () {
      expect(await tka.balanceOf(wallet.address)).to.equal(0n);
      expect(await tkb.balanceOf(wallet.address)).to.equal(0n);
      expect(await amm.balanceOf(wallet.address)).to.equal(T(100));
      expect(await tka.allowance(wallet.address, ammAddress)).to.equal(T(10));
      const [rA, rB] = await amm.getReserves();
      expect([rA, rB]).to.deep.equal([T(100), T(100)]);
      // The "100 TKA" a reader may see is the pool's balance, not the wallet's.
      expect(await tka.balanceOf(ammAddress)).to.equal(T(100));
    });

    it("reverts swapAForB(5e18) and swapAForB(1e18) with InsufficientBalance(TKA, 0, amount)", async function () {
      for (const amount of [T(5), T(1)]) {
        await expect(amm.connect(wallet).swapAForB(amount))
          .to.be.revertedWithCustomError(amm, "InsufficientBalance")
          .withArgs(await tka.getAddress(), 0n, amount);
      }
    });

    it("succeeds once the wallet actually holds TKA — the check was right, the balance was empty", async function () {
      await tka.mint(wallet.address, T(1)); // owner-only, exactly the remedy on Sepolia
      const quoted = await amm.getAmountOut(await tka.getAddress(), T(1));
      expect(quoted).to.equal(990_099009900990099n); // 0.990099009900990099 TKB

      await amm.connect(wallet).swapAForB(T(1));
      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(T(101));
      expect(rB).to.equal(99_009900990099009901n); // 99.009900990099009901 TKB
      expect(await tkb.balanceOf(wallet.address)).to.equal(quoted);
      expect(await tka.balanceOf(wallet.address)).to.equal(0n);
    });

    it("then 1 TKB -> TKA pays the documented 1.0099000099000099 TKA", async function () {
      await tka.mint(wallet.address, T(1));
      await amm.connect(wallet).swapAForB(T(1));
      // The first swap paid only 0.990099… TKB, so selling a whole 1 TKB needs more.
      await tkb.mint(wallet.address, T(1));
      await tkb.connect(wallet).approve(ammAddress, T(1));

      expect(await amm.getAmountOut(await tkb.getAddress(), T(1))).to.equal(1_009900009900009900n);
      await amm.connect(wallet).swapBForA(T(1));
      const [rA, rB] = await amm.getReserves();
      expect(rA).to.equal(99_990099990099990100n);
      expect(rB).to.equal(100_009900990099009901n);
    });

    it("can also be fixed by withdrawing some liquidity first", async function () {
      await amm.connect(wallet).removeLiquidity(T(10)); // 10% of the pool
      expect(await tka.balanceOf(wallet.address)).to.equal(T(10));
      await amm.connect(wallet).swapAForB(T(5)); // within the 10 TKA allowance
      expect(await tka.balanceOf(wallet.address)).to.equal(T(5));
    });

    it("then the reverse swap and repeated swaps keep reserves and k consistent", async function () {
      await tka.mint(wallet.address, T(50));
      await tkb.mint(wallet.address, T(50));
      await tka.connect(wallet).approve(ammAddress, T(50));
      await tkb.connect(wallet).approve(ammAddress, T(50));

      const sequence = [
        ["A", T(1)],
        ["B", T(1)],
        ["A", T(3)],
        ["A", 1_000_000_000_000n],
        ["B", T(7)],
      ];
      for (const [side, amountIn] of sequence) {
        const [rA, rB] = await amm.getReserves();
        const expected = side === "A" ? quote(amountIn, rA, rB) : quote(amountIn, rB, rA);
        const tx = side === "A" ? amm.connect(wallet).swapAForB(amountIn) : amm.connect(wallet).swapBForA(amountIn);
        await expect(tx).to.emit(amm, "Swap");
        const [nA, nB] = await amm.getReserves();
        if (side === "A") expect([nA, nB]).to.deep.equal([rA + amountIn, rB - expected]);
        else expect([nA, nB]).to.deep.equal([rA - expected, rB + amountIn]);
        expect(nA * nB).to.be.gte(rA * rB);
        await expectReservesMatchBalances();
      }
    });
  });

  // ===================================================================
  // 17. Reentrancy protection
  // ===================================================================
  describe("17. Reentrancy protection", function () {
    it("blocks a token that calls back into the pool during transferFrom", async function () {
      const Reentrant = await ethers.getContractFactory("ReentrantERC20");
      const evil = await Reentrant.deploy();
      const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
      const pool = await SimpleAMM.deploy(await evil.getAddress(), await tkb.getAddress());
      const poolAddress = await pool.getAddress();

      await evil.mint(provider.address, T(1000));
      await evil.connect(provider).approve(poolAddress, T(1000));
      await tkb.connect(provider).approve(poolAddress, T(1000));
      await pool.connect(provider).addLiquidity(T(100), T(100));

      // Next transferFrom re-enters swapAForB on the same pool.
      await evil.arm(poolAddress, pool.interface.encodeFunctionData("swapAForB", [T(1)]));
      const [rA, rB] = await pool.getReserves();

      await expect(pool.connect(provider).swapAForB(T(1))).to.be.revertedWithCustomError(
        pool,
        "ReentrancyGuardReentrantCall"
      );
      expect(await pool.getReserves()).to.deep.equal([rA, rB]);
    });
  });
});
