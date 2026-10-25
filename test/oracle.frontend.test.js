import { expect } from "chai";
import { network } from "hardhat";

import { fmtBps, fmtPpm, fmtPrice, fmtUsd } from "../frontend/src/platform/format.js";
import {
  oracleRate,
  poolDeviationPpm,
  positionUsd,
  protocolTvl,
  rewardAprBps,
  sumUsd,
  toPriceEntry,
  usablePrice,
  usdValue,
  valueDeltaPpm,
} from "../frontend/src/platform/pricing.js";

/**
 * VaultWise — PriceOracle frontend logic
 * ======================================
 *
 * The browser's USD valuation (frontend/src/platform/pricing.js), fed with
 * real `tryGetPrice` results from the compiled PriceOracle on the in-process
 * chain, and checked against the contract's own `getValue`. Also: stale and
 * missing prices never produce a number, TVL and APR arithmetic, and the
 * display formatting.
 *
 * Not covered here: React rendering.
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const usd = (value) => ethers.parseUnits(String(value), 18);
const DEX_TOKEN_ID = { A: "DXA", B: "DXB", C: "DXC" };

describe("VaultWise PriceOracle — frontend logic", function () {
  let oracle;
  let usdc;
  let dxa;
  let ethFeed;
  let prices; // as the snapshot builds it
  let tokens; // registry-shaped token objects

  /** Exactly what useProtocolData does: tryGetPrice per token -> toPriceEntry. */
  async function readPrices() {
    const entries = await Promise.all(
      [
        ["ETH", ETH_SENTINEL],
        ["USDC", await usdc.getAddress()],
        ["DXA", await dxa.getAddress()],
        ["vwUSDC", ethers.Wallet.createRandom().address], // no feed, like a vault share
      ].map(async ([id, address]) => [id, toPriceEntry(await oracle.tryGetPrice(address))])
    );
    return Object.fromEntries(entries);
  }

  beforeEach(async function () {
    oracle = await ethers.deployContract("PriceOracle");
    ethFeed = await ethers.deployContract("MockV3Aggregator", [8, 2349_50000000n, "ETH / USD"]);
    const usdcFeed = await ethers.deployContract("MockV3Aggregator", [8, 99984576n, "USDC / USD"]);
    usdc = await ethers.deployContract("MockUSDC");
    dxa = await ethers.deployContract("DexMockERC20", ["Token A", "DXA"]);
    await oracle.setFeed(ETH_SENTINEL, await ethFeed.getAddress(), 3600);
    await oracle.setFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 26 * 3600);
    await oracle.setFeed(await dxa.getAddress(), await ethFeed.getAddress(), 3600);
    tokens = {
      ETH: { id: "ETH", decimals: 18 },
      USDC: { id: "USDC", decimals: 6 },
      DXA: { id: "DXA", decimals: 18 },
      vwUSDC: { id: "vwUSDC", decimals: 6 },
    };
    prices = await readPrices();
  });

  it("decodes tryGetPrice into snapshot entries", async function () {
    expect(prices.ETH).to.deep.equal({ status: "ok", price: usd("2349.5"), updatedAt: Number(await ethFeed.latestTimestamp()) });
    expect(prices.vwUSDC).to.deep.equal({ status: "noFeed", price: null, updatedAt: null });
    expect(toPriceEntry(null)).to.deep.equal({ status: "error", price: null, updatedAt: null });
  });

  it("values amounts exactly as PriceOracle.getValue does, for 6- and 18-decimal tokens", async function () {
    for (const [token, address, raw] of [
      [tokens.USDC, await usdc.getAddress(), 1234_567891n],
      [tokens.ETH, ETH_SENTINEL, ethers.parseEther("0.123456789")],
      [tokens.DXA, await dxa.getAddress(), 1n],
      [tokens.DXA, await dxa.getAddress(), 10n ** 30n],
    ]) {
      expect(usdValue(raw, token, prices)).to.equal(await oracle.getValue(address, raw));
    }
  });

  it("never values with a stale, invalid or missing price", async function () {
    expect(usdValue(1n, tokens.vwUSDC, prices)).to.equal(null);
    expect(usdValue(null, tokens.ETH, prices)).to.equal(null);

    await time.increase(3601); // ETH and DXA feeds go stale, USDC (26 h) does not
    prices = await readPrices();
    expect(prices.ETH.status).to.equal("stale");
    expect(prices.ETH.price).to.equal(usd("2349.5")); // last value is kept for display...
    expect(usablePrice(tokens.ETH, prices)).to.equal(null); // ...but never used
    expect(usdValue(ethers.parseEther("1"), tokens.ETH, prices)).to.equal(null);
    expect(usdValue(1_000000n, tokens.USDC, prices)).to.equal(usd("0.99984576"));

    await ethFeed.updateAnswer(0n);
    prices = await readPrices();
    expect(prices.DXA.status).to.equal("invalid");
    expect(usdValue(1n, tokens.DXA, prices)).to.equal(null);
  });

  it("sums only when every part is known", function () {
    expect(sumUsd([usd(1), usd(2)])).to.equal(usd(3));
    expect(sumUsd([])).to.equal(0n);
    expect(sumUsd([usd(1), null])).to.equal(null);
    const position = { holdings: [{ token: tokens.USDC, raw: 100_000000n }, { token: tokens.DXA, raw: ethers.parseEther("2") }] };
    expect(positionUsd(position, prices)).to.equal(usd("99.984576") + usd("4699"));
    expect(positionUsd({ holdings: [{ token: tokens.vwUSDC, raw: 1n }] }, prices)).to.equal(null);
  });

  it("computes TVL per product and flags products without a live price", function () {
    const data = {
      tokens: { ...tokens, DXB: { id: "DXB", decimals: 18 }, TKA: { id: "TKA", decimals: 18 }, TKB: { id: "TKB", decimals: 18 } },
      prices,
      dex: {
        configured: true,
        pairs: {
          AB: { address: "0x1", x: "A", y: "B", reserveX: ethers.parseEther("1"), reserveY: ethers.parseEther("5") },
          AC: { address: null, x: "A", y: "C" }, // not created: ignored
        },
      },
      amm: { configured: false },
      vault4626: { configured: true, totalAssets: 1000_000000n },
      ethVault: { configured: true, total: ethers.parseEther("0.5") },
      farm: { configured: false },
      staking: { configured: false },
    };
    const tvl = protocolTvl(data, DEX_TOKEN_ID);
    expect(tvl.byProduct.vault4626).to.equal(usd("999.84576"));
    expect(tvl.byProduct.ethVault).to.equal(usd("1174.75"));
    expect(tvl.byProduct.dex).to.equal(null); // DXB has no price here
    expect(tvl.byProduct).to.not.have.property("amm"); // not deployed
    expect(tvl.total).to.equal(usd("999.84576") + usd("1174.75"));
    expect(tvl.complete).to.equal(false);
  });

  it("computes reward APR from emission and both prices", function () {
    // The farm's rate: 0.001 RWD per token per second = 86.4 RWD per token per day.
    const perDay = usd("86.4");
    // Reward $0.20, stake $2,000: 86.4 * 0.2 * 365 / 2000 = 3.1536 = 315.36%
    expect(rewardAprBps(perDay, usd("0.2"), usd("2000"))).to.equal(31536n);
    expect(rewardAprBps(perDay, null, usd("2000"))).to.equal(null);
    expect(rewardAprBps(null, usd("1"), usd("1"))).to.equal(null);
  });

  it("compares trades and pools with the oracle rate", function () {
    expect(valueDeltaPpm(usd(100), usd(95))).to.equal(-50_000);
    expect(valueDeltaPpm(usd(100), usd(101))).to.equal(10_000);
    expect(valueDeltaPpm(null, usd(1))).to.equal(null);

    // 1 DXA ($2,349.50) in USDC ($0.99984576)
    const rate = oracleRate(tokens.DXA, tokens.USDC, prices);
    expect(rate).to.equal((usd("2349.5") * 10n ** 18n) / usd("0.99984576"));

    // A pool holding 1 DXA : 2,349.862 USDC is ~0% off; at 2,000 USDC it is ~-14.9% off.
    const fair = poolDeviationPpm(ethers.parseEther("1"), 2349_862435n, tokens.DXA, tokens.USDC, prices);
    expect(Math.abs(fair)).to.be.below(10);
    const cheap = poolDeviationPpm(ethers.parseEther("1"), 2000_000000n, tokens.DXA, tokens.USDC, prices);
    expect(cheap).to.be.within(-149_000, -148_000);
    expect(poolDeviationPpm(0n, 1n, tokens.DXA, tokens.USDC, prices)).to.equal(null);
  });

  it("formats USD, prices, APR and deviations for display", function () {
    expect(fmtUsd(usd("1234.567"))).to.equal("$1,234.57");
    expect(fmtUsd(usd("0.004"))).to.equal("<$0.01");
    expect(fmtUsd(0n)).to.equal("$0.00");
    expect(fmtUsd(null)).to.equal("—");
    expect(fmtUsd(usd("2500000"))).to.equal("$2.5M");
    expect(fmtPrice(usd("80609.94899436"))).to.equal("$80,609.95");
    expect(fmtPrice(usd("0.19794655"))).to.equal("$0.197947");
    expect(fmtBps(31536n)).to.equal("315%");
    expect(fmtBps(425n)).to.equal("4.25%");
    expect(fmtPpm(-50_000)).to.equal("−5.00%");
    expect(fmtPpm(12_345)).to.equal("+1.23%");
  });
});
