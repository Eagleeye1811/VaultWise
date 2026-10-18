import { expect } from "chai";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 6 test suite (DEX prototype)
 * ===================================================
 *
 * DexMockERC20 (the sheet's MockERC20, public mint) + Pair + Factory + Router.
 *
 * Units. The sheet's ten scenarios are stated in RAW BASE UNITS: "1,000 A +
 * 4,000 B gives 1,000 LP with 1,000 locked" and "100 A in gives 181 B" are
 * only true when the numbers are the integers the contracts see. So the
 * scenario tests below use the sheet's numbers literally (1000n, not 1000e18).
 * Separate tests repeat the key cases with whole 18-decimal tokens.
 *
 * Every expectation is recomputed independently here (BigInt), not read back
 * from the contracts:
 *
 *     out = in*997*rOut / (rIn*1000 + in*997)          (floor)
 *     (bal0*1000 - in0*3)(bal1*1000 - in1*3) >= r0*r1*1000^2
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;

const MAX = ethers.MaxUint256;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const LOTS = 10n ** 30n;
const T = (amount) => ethers.parseUnits(String(amount), 18);

/** The sheet's swap formula, computed independently of the Router. */
const amountOut = (amountIn, reserveIn, reserveOut) =>
  (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n);

/** Integer square root (Babylonian), independent of OpenZeppelin's Math.sqrt. */
function isqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

describe("VaultWise Experiment 6 — DEX prototype", function () {
  let deployer;
  let alice;
  let bob;
  let A;
  let B;
  let C;
  let factory;
  let router;
  let routerAddress;
  let pairIface; // for errors that bubble up from a Pair through the Router

  const addr = (contract) => contract.getAddress();
  const deadline = async (seconds = 3600) => (await time.latest()) + seconds;

  /** Router.addLiquidity with no minimums, as `signer`. */
  async function addLiquidity(signer, X, Y, amountX, amountY) {
    return router
      .connect(signer)
      .addLiquidity(await addr(X), await addr(Y), amountX, amountY, 0, 0, signer.address, await deadline());
  }

  /** The Pair contract for two tokens. */
  async function pairOf(X, Y) {
    return ethers.getContractAt("Pair", await factory.getPair(await addr(X), await addr(Y)));
  }

  /** Reserves in (X, Y) order. */
  async function reserves(X, Y) {
    const [rX, rY] = await router.getReserves(await addr(X), await addr(Y));
    return [rX, rY];
  }

  /** [amount0Out, amount1Out] for receiving `amount` of `tokenOut` from `pair`. */
  async function outs(pair, tokenOut, amount) {
    return (await pair.token0()) === (await addr(tokenOut)) ? [amount, 0n] : [0n, amount];
  }

  async function swapPath(signer, amountIn, minOut, tokens, to = signer.address) {
    const path = await Promise.all(tokens.map(addr));
    return router.connect(signer).swapExactTokensForTokens(amountIn, minOut, path, to, await deadline());
  }

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DexMockERC20");
    A = await Token.deploy("Token A", "DXA");
    B = await Token.deploy("Token B", "DXB");
    C = await Token.deploy("Token C", "DXC");
    factory = await (await ethers.getContractFactory("Factory")).deploy();
    router = await (await ethers.getContractFactory("Router")).deploy(await addr(factory));
    routerAddress = await addr(router);
    pairIface = (await ethers.getContractFactory("Pair")).interface;

    for (const user of [deployer, alice, bob]) {
      for (const token of [A, B, C]) {
        await token.mint(user.address, LOTS);
        await token.connect(user).approve(routerAddress, MAX);
      }
    }
  });

  // ===================================================================
  // 1. ERC20 / MockERC20
  // ===================================================================
  describe("1. ERC20 and MockERC20 (DexMockERC20)", function () {
    it("has name, symbol and 18 decimals, and anyone can mint", async function () {
      expect(await A.name()).to.equal("Token A");
      expect(await A.symbol()).to.equal("DXA");
      expect(await A.decimals()).to.equal(18n);
      await expect(A.connect(bob).mint(bob.address, 5n))
        .to.emit(A, "Transfer")
        .withArgs(ethers.ZeroAddress, bob.address, 5n);
      expect(await A.totalSupply()).to.equal(LOTS * 3n + 5n);
    });

    it("transferFrom moves tokens and lowers a finite allowance", async function () {
      await expect(A.connect(alice).approve(bob.address, 100n))
        .to.emit(A, "Approval")
        .withArgs(alice.address, bob.address, 100n);
      await expect(A.connect(bob).transferFrom(alice.address, bob.address, 60n))
        .to.emit(A, "Transfer")
        .withArgs(alice.address, bob.address, 60n);
      expect(await A.allowance(alice.address, bob.address)).to.equal(40n);
    });

    it("reverts when the allowance is too small", async function () {
      await A.connect(alice).approve(bob.address, 100n);
      await expect(A.connect(bob).transferFrom(alice.address, bob.address, 101n))
        .to.be.revertedWithCustomError(A, "ERC20InsufficientAllowance")
        .withArgs(bob.address, 100n, 101n);
    });

    it("leaves the maximum allowance (2^256 - 1) untouched", async function () {
      await A.connect(alice).approve(bob.address, MAX);
      await A.connect(bob).transferFrom(alice.address, bob.address, 12345n);
      expect(await A.allowance(alice.address, bob.address)).to.equal(MAX);
    });
  });

  // ===================================================================
  // 2. Factory
  // ===================================================================
  describe("2. Factory", function () {
    it("creates a pair with sorted tokens, stored under both orderings", async function () {
      const [a, b] = [await addr(A), await addr(B)];
      const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];

      const tx = factory.createPair(b, a); // deliberately unsorted
      const predicted = ethers.getCreate2Address(
        await addr(factory),
        ethers.solidityPackedKeccak256(["address", "address"], [t0, t1]),
        ethers.keccak256((await ethers.getContractFactory("Pair")).bytecode)
      );
      await expect(tx).to.emit(factory, "PairCreated").withArgs(t0, t1, predicted, 1n);

      expect(await factory.getPair(a, b)).to.equal(predicted);
      expect(await factory.getPair(b, a)).to.equal(predicted);
      expect(await factory.allPairs(0)).to.equal(predicted);
      expect(await factory.allPairsLength()).to.equal(1n);

      const pair = await ethers.getContractAt("Pair", predicted);
      expect(await pair.token0()).to.equal(t0);
      expect(await pair.token1()).to.equal(t1);
      expect(await pair.factory()).to.equal(await addr(factory));
      expect(await pair.decimals()).to.equal(18n);
    });

    it("scenario 10: a duplicate pair reverts with PAIR_EXISTS, in either order", async function () {
      await factory.createPair(await addr(A), await addr(B));
      await expect(factory.createPair(await addr(A), await addr(B))).to.be.revertedWithCustomError(
        factory,
        "PAIR_EXISTS"
      );
      await expect(factory.createPair(await addr(B), await addr(A))).to.be.revertedWithCustomError(
        factory,
        "PAIR_EXISTS"
      );
      expect(await factory.allPairsLength()).to.equal(1n);
    });

    it("rejects identical tokens and the zero address", async function () {
      await expect(factory.createPair(await addr(A), await addr(A))).to.be.revertedWithCustomError(
        factory,
        "IDENTICAL_ADDRESSES"
      );
      await expect(factory.createPair(ethers.ZeroAddress, await addr(A))).to.be.revertedWithCustomError(
        factory,
        "ZERO_ADDRESS"
      );
      await expect(factory.createPair(await addr(A), ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZERO_ADDRESS"
      );
    });

    it("lets anyone create pairs and tracks them all", async function () {
      await factory.connect(alice).createPair(await addr(A), await addr(B));
      await factory.connect(bob).createPair(await addr(B), await addr(C));
      expect(await factory.allPairsLength()).to.equal(2n);
      expect(await factory.getPair(await addr(A), await addr(C))).to.equal(ethers.ZeroAddress);
    });
  });

  // ===================================================================
  // 3. Pair — direct (no Router): the Pair never pulls tokens
  // ===================================================================
  describe("3. Pair — initialize, mint and burn", function () {
    let pair;
    let pairAddress;

    beforeEach(async function () {
      await factory.createPair(await addr(A), await addr(B));
      pair = await pairOf(A, B);
      pairAddress = await addr(pair);
    });

    it("can be initialized only once, and only by its Factory", async function () {
      await expect(pair.connect(alice).initialize(await addr(A), await addr(B))).to.be.revertedWithCustomError(
        pair,
        "FORBIDDEN"
      );
      // A Pair deployed by an EOA has that EOA as factory: second call must fail.
      const solo = await (await ethers.getContractFactory("Pair")).deploy();
      await solo.initialize(await addr(A), await addr(B));
      await expect(solo.initialize(await addr(A), await addr(C))).to.be.revertedWithCustomError(
        solo,
        "ALREADY_INITIALIZED"
      );
    });

    it("scenario 1: 1,000 A + 4,000 B -> 1,000 LP, 1,000 locked, supply 2,000", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 4000n);
      const [amount0, amount1] = (await pair.token0()) === (await addr(A)) ? [1000n, 4000n] : [4000n, 1000n];

      expect(isqrt(1000n * 4000n) - 1000n).to.equal(1000n); // the hand calculation
      const tx = pair.mint(alice.address);
      await expect(tx).to.emit(pair, "Mint").withArgs(deployer.address, amount0, amount1, 1000n, alice.address);
      await expect(tx).to.emit(pair, "Sync").withArgs(amount0, amount1);
      await expect(tx).to.emit(pair, "Transfer").withArgs(ethers.ZeroAddress, DEAD, 1000n);

      expect(await pair.balanceOf(alice.address)).to.equal(1000n);
      expect(await pair.balanceOf(DEAD)).to.equal(1000n);
      expect(await pair.totalSupply()).to.equal(2000n);
      expect(await reserves(A, B)).to.deep.equal([1000n, 4000n]);
    });

    it("milestone: burning those 1,000 LP returns 500 A + 2,000 B", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 4000n);
      await pair.mint(alice.address);
      const [beforeA, beforeB] = [await A.balanceOf(alice.address), await B.balanceOf(alice.address)];

      await pair.connect(alice).transfer(pairAddress, 1000n);
      const [amount0, amount1] = (await pair.token0()) === (await addr(A)) ? [500n, 2000n] : [2000n, 500n];
      await expect(pair.burn(alice.address))
        .to.emit(pair, "Burn")
        .withArgs(deployer.address, amount0, amount1, 1000n, alice.address);

      expect((await A.balanceOf(alice.address)) - beforeA).to.equal(500n);
      expect((await B.balanceOf(alice.address)) - beforeB).to.equal(2000n);
      expect(await pair.totalSupply()).to.equal(1000n); // only the locked LP is left
      expect(await reserves(A, B)).to.deep.equal([500n, 2000n]);
    });

    it("later deposits get the smaller pro-rata share", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 4000n);
      await pair.mint(alice.address);
      // 300 A would justify 300*2000/1000 = 600 LP; 800 B only 800*2000/4000 = 400.
      await A.transfer(pairAddress, 300n);
      await B.transfer(pairAddress, 800n);
      await pair.mint(bob.address);
      expect(await pair.balanceOf(bob.address)).to.equal(400n);
      expect(await reserves(A, B)).to.deep.equal([1300n, 4800n]);
    });

    it("rejects a first deposit too small to cover the locked 1,000 LP", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 1000n); // sqrt = 1000, nothing left
      await expect(pair.mint(alice.address)).to.be.revertedWithCustomError(pair, "INSUFFICIENT_LIQUIDITY_MINTED");
    });

    it("rejects mint with nothing sent and burn with no LP sent", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 4000n);
      await pair.mint(alice.address);
      await expect(pair.mint(alice.address)).to.be.revertedWithCustomError(pair, "INSUFFICIENT_LIQUIDITY_MINTED");
      await expect(pair.burn(alice.address)).to.be.revertedWithCustomError(pair, "INSUFFICIENT_LIQUIDITY_BURNED");
    });

    it("its LP token is a normal ERC20 (transfer, approve, allowance)", async function () {
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 4000n);
      await pair.mint(alice.address);
      await pair.connect(alice).approve(bob.address, 300n);
      await pair.connect(bob).transferFrom(alice.address, bob.address, 200n);
      expect(await pair.balanceOf(bob.address)).to.equal(200n);
      expect(await pair.allowance(alice.address, bob.address)).to.equal(100n);
    });
  });

  describe("4. Pair — swap and the fee-adjusted invariant", function () {
    let pair;
    let pairAddress;

    /** The sheet's swap pool: 1,000 A / 2,000 B. */
    beforeEach(async function () {
      await factory.createPair(await addr(A), await addr(B));
      pair = await pairOf(A, B);
      pairAddress = await addr(pair);
      await A.transfer(pairAddress, 1000n);
      await B.transfer(pairAddress, 2000n);
      await pair.mint(deployer.address);
    });

    it("scenario 2: 100 A in -> 181 B out; reserves 1,100 / 1,819; k = 2,000,900", async function () {
      expect(amountOut(100n, 1000n, 2000n)).to.equal(181n);
      await A.connect(alice).transfer(pairAddress, 100n);
      const [o0, o1] = await outs(pair, B, 181n);
      const aIs0 = (await pair.token0()) === (await addr(A));

      const before = await B.balanceOf(alice.address);
      const tx = pair.connect(alice).swap(o0, o1, alice.address);
      await expect(tx)
        .to.emit(pair, "Swap")
        .withArgs(alice.address, aIs0 ? 100n : 0n, aIs0 ? 0n : 100n, o0, o1, alice.address);
      await expect(tx).to.emit(pair, "Sync").withArgs(aIs0 ? 1100n : 1819n, aIs0 ? 1819n : 1100n);

      expect((await B.balanceOf(alice.address)) - before).to.equal(181n);
      const [rA, rB] = await reserves(A, B);
      expect([rA, rB]).to.deep.equal([1100n, 1819n]);
      expect(rA * rB).to.equal(2_000_900n);
      expect(rA * rB).to.be.greaterThan(1000n * 2000n); // the fee stays in the pool: k grew
    });

    it("scenario 3: asking for 182 B for the same 100 A reverts with K", async function () {
      // (1100*1000 - 300) * (1818*1000) = 1,999,254,600,000 < 2,000,000,000,000
      expect((1100n * 1000n - 300n) * (1818n * 1000n)).to.be.lessThan(1000n * 2000n * 1000n ** 2n);
      await A.connect(alice).transfer(pairAddress, 100n);
      const [o0, o1] = await outs(pair, B, 182n);
      await expect(pair.connect(alice).swap(o0, o1, alice.address)).to.be.revertedWithCustomError(pair, "K");
    });

    it("scenario 4: swap without sending input reverts with INSUFFICIENT_INPUT_AMOUNT", async function () {
      const [o0, o1] = await outs(pair, B, 181n);
      await expect(pair.connect(alice).swap(o0, o1, alice.address)).to.be.revertedWithCustomError(
        pair,
        "INSUFFICIENT_INPUT_AMOUNT"
      );
    });

    it("accepts exactly the formula's output and rejects one unit more, at many sizes", async function () {
      for (const amountIn of [1n, 7n, 100n, 999n, 5000n]) {
        const [rA, rB] = await reserves(A, B);
        const out = amountOut(amountIn, rA, rB);
        await A.connect(alice).transfer(pairAddress, amountIn);
        const [x0, x1] = await outs(pair, B, out + 1n);
        if (out + 1n < rB) {
          await expect(pair.connect(alice).swap(x0, x1, alice.address)).to.be.revertedWithCustomError(pair, "K");
        }
        if (out > 0n) {
          const [o0, o1] = await outs(pair, B, out);
          await pair.connect(alice).swap(o0, o1, alice.address);
        } else {
          // 1 A buys 0 B at this price: the input is simply a donation; resync it with a real trade later
          await expect(pair.connect(alice).swap(x0, x1, alice.address)).to.be.reverted;
        }
      }
    });

    it("rejects zero output, output >= reserve, and `to` equal to a pool token", async function () {
      await expect(pair.swap(0n, 0n, alice.address)).to.be.revertedWithCustomError(pair, "INSUFFICIENT_OUTPUT_AMOUNT");
      const [o0, o1] = await outs(pair, B, 2000n);
      await expect(pair.swap(o0, o1, alice.address)).to.be.revertedWithCustomError(pair, "INSUFFICIENT_LIQUIDITY");
      const [p0, p1] = await outs(pair, B, 1n);
      await expect(pair.swap(p0, p1, await addr(A))).to.be.revertedWithCustomError(pair, "INVALID_TO");
    });
  });

  // ===================================================================
  // 5. Router — helpers
  // ===================================================================
  describe("5. Router helpers", function () {
    it("sortTokens orders addresses and rejects identical / zero", async function () {
      const [a, b] = [await addr(A), await addr(B)];
      const sorted = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
      expect(await router.sortTokens(a, b)).to.deep.equal(sorted);
      expect(await router.sortTokens(b, a)).to.deep.equal(sorted);
      await expect(router.sortTokens(a, a)).to.be.revertedWithCustomError(router, "IDENTICAL_ADDRESSES");
      await expect(router.sortTokens(a, ethers.ZeroAddress)).to.be.revertedWithCustomError(router, "ZERO_ADDRESS");
    });

    it("getAmountOut uses the sheet's formula exactly", async function () {
      expect(await router.getAmountOut(100n, 1000n, 2000n)).to.equal(181n);
      expect(await router.getAmountOut(100n, 1020n, 1961n)).to.equal(174n);
      expect(await router.getAmountOut(181n, 4000n, 500n)).to.equal(21n);
      for (const [i, r1, r2] of [
        [T(1), T(1000), T(2000)],
        [123_456_789n, 987_654_321_000n, 55_555n],
      ]) {
        expect(await router.getAmountOut(i, r1, r2)).to.equal(amountOut(i, r1, r2));
      }
      await expect(router.getAmountOut(0n, 1n, 1n)).to.be.revertedWithCustomError(router, "INSUFFICIENT_INPUT_AMOUNT");
      await expect(router.getAmountOut(1n, 0n, 1n)).to.be.revertedWithCustomError(router, "INSUFFICIENT_LIQUIDITY");
    });

    it("quote keeps the ratio and getReserves follows the argument order", async function () {
      expect(await router.quote(500n, 1000n, 4000n)).to.equal(2000n);
      await expect(router.quote(0n, 1n, 1n)).to.be.revertedWithCustomError(router, "INSUFFICIENT_AMOUNT");
      await expect(router.quote(1n, 0n, 1n)).to.be.revertedWithCustomError(router, "INSUFFICIENT_LIQUIDITY");

      expect(await reserves(A, B)).to.deep.equal([0n, 0n]); // no pool yet
      await addLiquidity(deployer, A, B, 1000n, 4000n);
      expect(await reserves(A, B)).to.deep.equal([1000n, 4000n]);
      expect(await reserves(B, A)).to.deep.equal([4000n, 1000n]);
    });
  });

  // ===================================================================
  // 6. Router — liquidity
  // ===================================================================
  describe("6. Router — addLiquidity and removeLiquidity", function () {
    it("creates the pair automatically and reproduces scenario 1", async function () {
      expect(await factory.getPair(await addr(A), await addr(B))).to.equal(ethers.ZeroAddress);
      await expect(addLiquidity(alice, A, B, 1000n, 4000n)).to.emit(factory, "PairCreated");
      const pair = await pairOf(A, B);
      expect(await pair.balanceOf(alice.address)).to.equal(1000n);
      expect(await pair.balanceOf(DEAD)).to.equal(1000n);
      expect(await pair.totalSupply()).to.equal(2000n);
      expect(await reserves(A, B)).to.deep.equal([1000n, 4000n]);
      expect(await A.balanceOf(routerAddress)).to.equal(0n); // the Router never keeps tokens
    });

    it("scenario 9: 500 A + 3,000 B desired into 1,000/4,000 uses 500 A + 2,000 B and mints 1,000 LP", async function () {
      await addLiquidity(deployer, A, B, 1000n, 4000n);
      const pair = await pairOf(A, B);
      expect(await pair.totalSupply()).to.equal(2000n);

      const args = [await addr(A), await addr(B), 500n, 3000n, 0n, 0n, bob.address, await deadline()];
      expect(await router.connect(bob).addLiquidity.staticCall(...args)).to.deep.equal([500n, 2000n, 1000n]);

      const [a0, b0] = [await A.balanceOf(bob.address), await B.balanceOf(bob.address)];
      await router.connect(bob).addLiquidity(...args);
      expect(a0 - (await A.balanceOf(bob.address))).to.equal(500n);
      expect(b0 - (await B.balanceOf(bob.address))).to.equal(2000n); // not 3,000
      expect(await pair.balanceOf(bob.address)).to.equal(1000n);
      expect(await reserves(A, B)).to.deep.equal([1500n, 6000n]); // ratio unchanged
    });

    it("reduces A instead when B is the short side", async function () {
      await addLiquidity(deployer, A, B, 1000n, 4000n);
      const args = [await addr(A), await addr(B), 500n, 1000n, 0n, 0n, bob.address, await deadline()];
      // B optimal for 500 A = 2000 > 1000, so A = 1000 * 1000 / 4000 = 250
      expect(await router.connect(bob).addLiquidity.staticCall(...args)).to.deep.equal([250n, 1000n, 500n]);
    });

    it("enforces the minimum amounts and the deadline", async function () {
      await addLiquidity(deployer, A, B, 1000n, 4000n);
      const [a, b] = [await addr(A), await addr(B)];
      const later = await deadline();
      await expect(
        router.connect(bob).addLiquidity(a, b, 500n, 3000n, 0n, 2001n, bob.address, later)
      ).to.be.revertedWithCustomError(router, "INSUFFICIENT_B_AMOUNT");
      await expect(
        router.connect(bob).addLiquidity(a, b, 500n, 1000n, 251n, 0n, bob.address, later)
      ).to.be.revertedWithCustomError(router, "INSUFFICIENT_A_AMOUNT");
      await expect(
        router.connect(bob).addLiquidity(a, b, 500n, 3000n, 0n, 0n, bob.address, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(router, "EXPIRED");
    });

    it("removes liquidity proportionally after an LP approval", async function () {
      await addLiquidity(alice, A, B, 1000n, 4000n); // alice: 1000 LP of 2000
      const pair = await pairOf(A, B);
      const [a, b] = [await addr(A), await addr(B)];

      await expect(
        router.connect(alice).removeLiquidity(a, b, 400n, 0n, 0n, alice.address, await deadline())
      ).to.be.revertedWithCustomError(pair, "ERC20InsufficientAllowance");

      await pair.connect(alice).approve(routerAddress, 400n);
      const [a0, b0] = [await A.balanceOf(alice.address), await B.balanceOf(alice.address)];
      await expect(router.connect(alice).removeLiquidity(b, a, 400n, 0n, 0n, alice.address, await deadline()))
        .to.emit(pair, "Burn");
      // 400 of 2000 LP = 1/5 of each reserve
      expect((await A.balanceOf(alice.address)) - a0).to.equal(200n);
      expect((await B.balanceOf(alice.address)) - b0).to.equal(800n);
      expect(await pair.balanceOf(alice.address)).to.equal(600n);
      expect(await pair.allowance(alice.address, routerAddress)).to.equal(0n);
      expect(await reserves(A, B)).to.deep.equal([800n, 3200n]);
    });

    it("enforces removal minimums, the deadline and an existing pair", async function () {
      await addLiquidity(alice, A, B, 1000n, 4000n);
      const pair = await pairOf(A, B);
      await pair.connect(alice).approve(routerAddress, MAX);
      const [a, b, c] = [await addr(A), await addr(B), await addr(C)];
      await expect(
        router.connect(alice).removeLiquidity(a, b, 400n, 201n, 0n, alice.address, await deadline())
      ).to.be.revertedWithCustomError(router, "INSUFFICIENT_A_AMOUNT");
      await expect(
        router.connect(alice).removeLiquidity(a, b, 400n, 0n, 801n, alice.address, await deadline())
      ).to.be.revertedWithCustomError(router, "INSUFFICIENT_B_AMOUNT");
      await expect(
        router.connect(alice).removeLiquidity(a, b, 400n, 0n, 0n, alice.address, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(router, "EXPIRED");
      await expect(router.connect(alice).removeLiquidity(a, c, 1n, 0n, 0n, alice.address, await deadline()))
        .to.be.revertedWithCustomError(router, "PAIR_NOT_FOUND")
        .withArgs(a, c);
    });
  });

  // ===================================================================
  // 7. Router — swaps (the sheet's scenarios 2, 5–8)
  // ===================================================================
  describe("7. Router — swapExactTokensForTokens", function () {
    beforeEach(async function () {
      await addLiquidity(deployer, A, B, 1000n, 2000n); // the sheet's swap pool
    });

    it("scenario 2 through the Router: 100 A -> 181 B", async function () {
      const path = [await addr(A), await addr(B)];
      expect(await router.getAmountsOut(100n, path)).to.deep.equal([100n, 181n]);
      const before = await B.balanceOf(alice.address);
      await swapPath(alice, 100n, 181n, [A, B]);
      expect((await B.balanceOf(alice.address)) - before).to.equal(181n);
      expect(await reserves(A, B)).to.deep.equal([1100n, 1819n]);
      expect(await A.balanceOf(routerAddress)).to.equal(0n);
      expect(await B.balanceOf(routerAddress)).to.equal(0n);
    });

    it("scenario 5: after another trader sells 20 A, 100 A with amountOutMin 179 reverts", async function () {
      expect(amountOut(20n, 1000n, 2000n)).to.equal(39n);
      await swapPath(bob, 20n, 0n, [A, B]);
      expect(await reserves(A, B)).to.deep.equal([1020n, 1961n]);
      expect(amountOut(100n, 1020n, 1961n)).to.equal(174n);
      expect(await router.getAmountsOut(100n, [await addr(A), await addr(B)])).to.deep.equal([100n, 174n]);

      await expect(swapPath(alice, 100n, 179n, [A, B])).to.be.revertedWithCustomError(
        router,
        "INSUFFICIENT_OUTPUT_AMOUNT"
      );
      // Without the front-run the same order would have passed (181 >= 179); with a 174 limit it still does.
      await swapPath(alice, 100n, 174n, [A, B]);
    });

    it("scenario 6: a deadline in the past reverts with EXPIRED", async function () {
      const path = [await addr(A), await addr(B)];
      const past = (await time.latest()) - 1;
      await expect(
        router.connect(alice).swapExactTokensForTokens(100n, 0n, path, alice.address, past)
      ).to.be.revertedWithCustomError(router, "EXPIRED");
    });

    it("scenario 7: approving 100 A and swapping 200 A reverts in transferFrom", async function () {
      await A.connect(alice).approve(routerAddress, 100n);
      await expect(swapPath(alice, 200n, 0n, [A, B]))
        .to.be.revertedWithCustomError(A, "ERC20InsufficientAllowance")
        .withArgs(routerAddress, 100n, 200n);
      expect(await reserves(A, B)).to.deep.equal([1000n, 2000n]);
    });

    it("scenario 8: multi-hop A -> B -> C turns 100 A into 21 C", async function () {
      await addLiquidity(deployer, B, C, 4000n, 500n);
      expect(amountOut(181n, 4000n, 500n)).to.equal(21n);
      const path = [await addr(A), await addr(B), await addr(C)];
      expect(await router.getAmountsOut(100n, path)).to.deep.equal([100n, 181n, 21n]);

      const pool1 = await pairOf(A, B);
      const pool2 = await pairOf(B, C);
      const before = await C.balanceOf(alice.address);
      const tx = swapPath(alice, 100n, 21n, [A, B, C]);
      // hop 1 pays straight into pool 2, hop 2 pays the trader
      const [h1o0, h1o1] = await outs(pool1, B, 181n);
      const [h2o0, h2o1] = await outs(pool2, C, 21n);
      await expect(tx).to.emit(pool1, "Swap").withArgs(routerAddress, h1o0 ? 0n : 100n, h1o0 ? 100n : 0n, h1o0, h1o1, await addr(pool2));
      await expect(tx).to.emit(pool2, "Swap").withArgs(routerAddress, h2o0 ? 0n : 181n, h2o0 ? 181n : 0n, h2o0, h2o1, alice.address);

      expect((await C.balanceOf(alice.address)) - before).to.equal(21n);
      expect(await reserves(A, B)).to.deep.equal([1100n, 1819n]);
      expect(await reserves(B, C)).to.deep.equal([4181n, 479n]);
      expect(await B.balanceOf(routerAddress)).to.equal(0n);
    });

    it("multi-hop: insufficient output, missing pool and invalid paths revert", async function () {
      await addLiquidity(deployer, B, C, 4000n, 500n);
      const [a, b, c] = [await addr(A), await addr(B), await addr(C)];
      await expect(swapPath(alice, 100n, 22n, [A, B, C])).to.be.revertedWithCustomError(
        router,
        "INSUFFICIENT_OUTPUT_AMOUNT"
      );
      await expect(swapPath(alice, 100n, 0n, [A, C]))
        .to.be.revertedWithCustomError(router, "PAIR_NOT_FOUND")
        .withArgs(a, c);
      await expect(swapPath(alice, 100n, 0n, [A])).to.be.revertedWithCustomError(router, "INVALID_PATH");
      await expect(swapPath(alice, 100n, 0n, [A, A])).to.be.revertedWithCustomError(router, "IDENTICAL_ADDRESSES");
      await expect(router.getAmountsOut(100n, [a, b, a, c])).to.be.revertedWithCustomError(router, "PAIR_NOT_FOUND");
      await expect(swapPath(alice, 0n, 0n, [A, B])).to.be.revertedWithCustomError(router, "INSUFFICIENT_INPUT_AMOUNT");
    });

    it("the reverse direction works too (B -> A), and k never decreases", async function () {
      const [rA, rB] = await reserves(A, B);
      const expected = amountOut(300n, rB, rA);
      const before = await A.balanceOf(alice.address);
      await swapPath(alice, 300n, expected, [B, A]);
      expect((await A.balanceOf(alice.address)) - before).to.equal(expected);
      const [nA, nB] = await reserves(A, B);
      expect(nA * nB).to.be.greaterThanOrEqual(rA * rB);
    });
  });

  // ===================================================================
  // 8. Whole 18-decimal tokens
  // ===================================================================
  describe("8. The same maths with whole 18-decimal tokens", function () {
    it("first deposit locks only 1,000 base units, not 1,000 tokens", async function () {
      await addLiquidity(alice, A, B, T(1000), T(4000));
      const pair = await pairOf(A, B);
      expect(await pair.totalSupply()).to.equal(T(2000));
      expect(await pair.balanceOf(alice.address)).to.equal(T(2000) - 1000n);
    });

    it("100 A into 1,000 A / 2,000 B pays 181.32... B, exactly the formula", async function () {
      await addLiquidity(deployer, A, B, T(1000), T(2000));
      const expected = amountOut(T(100), T(1000), T(2000));
      expect(ethers.formatUnits(expected, 18)).to.match(/^181\.3221787760/);
      const before = await B.balanceOf(alice.address);
      await swapPath(alice, T(100), expected, [A, B]);
      expect((await B.balanceOf(alice.address)) - before).to.equal(expected);
    });
  });

  // ===================================================================
  // 9. Reentrancy and hostile tokens
  // ===================================================================
  describe("9. Reentrancy and hostile tokens", function () {
    let H; // HostileERC20: re-enters, charges a fee, or returns false on demand
    let hAddress;

    beforeEach(async function () {
      H = await (await ethers.getContractFactory("HostileERC20")).deploy();
      hAddress = await addr(H);
      for (const user of [deployer, alice]) {
        await H.mint(user.address, LOTS);
        await H.connect(user).approve(routerAddress, MAX);
      }
      await addLiquidity(deployer, A, H, 10_000n, 10_000n);
    });

    it("a token that re-enters Pair.swap while being paid out is blocked", async function () {
      const pair = await pairOf(A, H);
      const [o0, o1] = await outs(pair, H, 1n);
      await H.setReenter(await addr(pair), pairIface.encodeFunctionData("swap", [o0, o1, alice.address]));
      await expect(swapPath(alice, 100n, 0n, [A, H])).to.be.revertedWithCustomError(
        pair,
        "ReentrancyGuardReentrantCall"
      );
      expect(await reserves(A, H)).to.deep.equal([10_000n, 10_000n]);
    });

    it("a token that re-enters the Router during transferFrom is blocked", async function () {
      const payload = router.interface.encodeFunctionData("swapExactTokensForTokens", [
        1n,
        0n,
        [hAddress, await addr(A)],
        alice.address,
        (await time.latest()) + 3600,
      ]);
      await H.setReenter(routerAddress, payload);
      await expect(swapPath(alice, 100n, 0n, [H, A])).to.be.revertedWithCustomError(
        router,
        "ReentrancyGuardReentrantCall"
      );
    });

    it("a fee-on-transfer input token fails the invariant (K) instead of draining the pool", async function () {
      const pair = await pairOf(A, H);
      await H.setFee(100); // 1 %
      await expect(swapPath(alice, 1000n, 0n, [H, A])).to.be.revertedWithCustomError(pair, "K");
    });

    it("a token whose transfer returns false is treated as a failure (SafeERC20)", async function () {
      await H.setReturnFalse();
      await expect(swapPath(alice, 100n, 0n, [H, A])).to.be.revertedWithCustomError(
        router,
        "SafeERC20FailedOperation"
      );
    });
  });
});

// =====================================================================
// 10. LPFarm (optional extension)
// =====================================================================
describe("VaultWise Experiment 6 — LPFarm (optional)", function () {
  const RATE = T(1); // 1 reward token per second, shared by all stakers
  let deployer;
  let alice;
  let bob;
  let lp; // a real Pair LP token
  let rwd;
  let farm;
  let farmAddress;

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DexMockERC20");
    const A = await Token.deploy("Token A", "DXA");
    const B = await Token.deploy("Token B", "DXB");
    rwd = await Token.deploy("Reward", "RWD");
    const factory = await (await ethers.getContractFactory("Factory")).deploy();
    const router = await (await ethers.getContractFactory("Router")).deploy(await factory.getAddress());
    const routerAddress = await router.getAddress();

    // Each user provides liquidity to get real LP tokens.
    for (const user of [alice, bob]) {
      for (const token of [A, B]) {
        await token.mint(user.address, T(10_000));
        await token.connect(user).approve(routerAddress, MAX);
      }
      await router
        .connect(user)
        .addLiquidity(await A.getAddress(), await B.getAddress(), T(1000), T(1000), 0, 0, user.address, (await time.latest()) + 60);
    }
    lp = await ethers.getContractAt("Pair", await factory.getPair(await A.getAddress(), await B.getAddress()));

    farm = await (await ethers.getContractFactory("LPFarm")).deploy(await lp.getAddress(), await rwd.getAddress(), RATE);
    farmAddress = await farm.getAddress();
    await rwd.mint(farmAddress, T(1_000_000));
    for (const user of [alice, bob]) await lp.connect(user).approve(farmAddress, MAX);
  });

  const at = (timestamp) => time.setNextBlockTimestamp(timestamp);

  it("pays one staker the full rate per second", async function () {
    await farm.connect(alice).deposit(T(100));
    const t0 = await time.latest();
    await time.increaseTo(t0 + 10);
    expect(await farm.pendingReward(alice.address)).to.equal(T(10));

    await at(t0 + 20);
    await expect(farm.connect(alice).withdraw(T(100)))
      .to.emit(farm, "RewardPaid")
      .withArgs(alice.address, T(20));
    expect(await lp.balanceOf(farmAddress)).to.equal(0n);
    expect(await farm.pendingReward(alice.address)).to.equal(0n);
  });

  it("shares rewards in proportion to stake over time", async function () {
    await farm.connect(alice).deposit(T(100));
    const t0 = await time.latest();
    await at(t0 + 10);
    await farm.connect(bob).deposit(T(300)); // alice alone for 10 s, then 1 : 3
    await time.increaseTo(t0 + 30);
    // alice: 10 + 20 * 1/4 = 15;  bob: 20 * 3/4 = 15
    expect(await farm.pendingReward(alice.address)).to.equal(T(15));
    expect(await farm.pendingReward(bob.address)).to.equal(T(15));
  });

  it("deposit(0) claims, and nothing accrues while nothing is staked", async function () {
    await time.increase(100);
    await farm.connect(alice).deposit(T(50));
    const t0 = await time.latest();
    expect(await farm.pendingReward(alice.address)).to.equal(0n);
    await at(t0 + 5);
    await expect(farm.connect(alice).deposit(0)).to.emit(farm, "RewardPaid").withArgs(alice.address, T(5));
    expect((await farm.userInfo(alice.address)).amount).to.equal(T(50));
  });

  it("rejects withdrawing more than staked", async function () {
    await farm.connect(alice).deposit(T(10));
    await expect(farm.connect(alice).withdraw(T(11)))
      .to.be.revertedWithCustomError(farm, "INSUFFICIENT_STAKE")
      .withArgs(T(10), T(11));
  });

  it("an under-funded farm still returns LP, pays what it has and owes the rest", async function () {
    const poor = await (await ethers.getContractFactory("LPFarm")).deploy(await lp.getAddress(), await rwd.getAddress(), RATE);
    const poorAddress = await poor.getAddress();
    await rwd.mint(poorAddress, T(4));
    await lp.connect(alice).approve(poorAddress, MAX);
    await poor.connect(alice).deposit(T(100));
    const t0 = await time.latest();

    await at(t0 + 10);
    await expect(poor.connect(alice).withdraw(T(100))).to.emit(poor, "RewardPaid").withArgs(alice.address, T(4));
    expect((await poor.userInfo(alice.address)).unpaidReward).to.equal(T(6));
    expect(await poor.pendingReward(alice.address)).to.equal(T(6));

    await rwd.mint(poorAddress, T(100));
    await expect(poor.connect(alice).deposit(0)).to.emit(poor, "RewardPaid").withArgs(alice.address, T(6));
  });

  it("never pays out more than it emitted (rounding stays in the farm)", async function () {
    await farm.connect(alice).deposit(7n);
    await farm.connect(bob).deposit(13n);
    const t0 = await time.latest();
    await at(t0 + 33);
    await farm.connect(alice).withdraw(7n);
    await at(t0 + 34);
    await farm.connect(bob).withdraw(13n);
    const paid = (await rwd.balanceOf(alice.address)) + (await rwd.balanceOf(bob.address));
    const emitted = RATE * BigInt(34 + 1); // from alice's deposit block onward, at most
    expect(paid).to.be.lessThanOrEqual(emitted);
    expect(paid).to.be.greaterThan(RATE * 33n);
  });

  it("rejects bad constructor arguments", async function () {
    const Farm = await ethers.getContractFactory("LPFarm");
    await expect(Farm.deploy(ethers.ZeroAddress, await rwd.getAddress(), RATE)).to.be.revertedWithCustomError(farm, "ZERO_ADDRESS");
    await expect(Farm.deploy(await rwd.getAddress(), await rwd.getAddress(), RATE)).to.be.revertedWithCustomError(farm, "IDENTICAL_ADDRESSES");
  });
});
