import { expect } from "chai";
import { network } from "hardhat";

/**
 * VaultWise — PriceOracle test suite
 * ==================================
 *
 * PriceOracle + MockV3Aggregator (a Chainlink feed the test controls).
 *
 * Covers registration rules, 18-decimal normalisation for 8-, 18- and
 * 0-decimal feeds, USD valuation for 6- and 18-decimal tokens, every
 * rejection path (no feed, zero/negative answer, missing or future
 * timestamp, stale round, reverting feed), the non-reverting tryGetPrice
 * statuses, the token list under add/replace/remove, and two-step ownership.
 */

const { ethers, networkHelpers } = await network.getOrCreate();
const { time } = networkHelpers;

const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const HOUR = 3600;
const Status = { Ok: 0n, NoFeed: 1n, InvalidPrice: 2n, Stale: 3n };

describe("VaultWise PriceOracle", function () {
  let owner;
  let alice;
  let oracle;
  let ethFeed; // 8 decimals, $2,349.50
  let usdcFeed; // 8 decimals, $0.99984576
  let usdc; // MockUSDC, 6 decimals
  let token; // MockERC20, 18 decimals

  const deployFeed = (decimals, answer, description = "TEST / USD") =>
    ethers.deployContract("MockV3Aggregator", [decimals, answer, description]);

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    oracle = await ethers.deployContract("PriceOracle");
    ethFeed = await deployFeed(8, 2349_50000000n, "ETH / USD");
    usdcFeed = await deployFeed(8, 99984576n, "USDC / USD");
    usdc = await ethers.deployContract("MockUSDC");
    token = await ethers.deployContract("MockERC20", ["Token A", "TKA"]);
  });

  describe("registration", function () {
    it("stores the feed, its decimals and the token's decimals, and emits FeedSet", async function () {
      await expect(oracle.setFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 26 * HOUR))
        .to.emit(oracle, "FeedSet")
        .withArgs(await usdc.getAddress(), await usdcFeed.getAddress(), 26 * HOUR);
      const [aggregator, maxStaleness, feedDecimals, tokenDecimals] = await oracle.feedOf(await usdc.getAddress());
      expect(aggregator).to.equal(await usdcFeed.getAddress());
      expect(maxStaleness).to.equal(26n * 3600n);
      expect(feedDecimals).to.equal(8n);
      expect(tokenDecimals).to.equal(6n);
    });

    it("prices native ETH under the sentinel address with 18 decimals", async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), 2 * HOUR);
      expect(await oracle.ETH()).to.equal(ETH);
      const [, , , tokenDecimals] = await oracle.feedOf(ETH);
      expect(tokenDecimals).to.equal(18n);
    });

    it("is owner-only", async function () {
      await expect(oracle.connect(alice).setFeed(ETH, await ethFeed.getAddress(), HOUR))
        .to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      await expect(oracle.connect(alice).removeFeed(ETH)).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("rejects zero addresses and non-contracts", async function () {
      const feed = await ethFeed.getAddress();
      await expect(oracle.setFeed(ethers.ZeroAddress, feed, HOUR)).to.be.revertedWithCustomError(oracle, "ZeroAddress");
      await expect(oracle.setFeed(ETH, ethers.ZeroAddress, HOUR)).to.be.revertedWithCustomError(oracle, "ZeroAddress");
      await expect(oracle.setFeed(ETH, alice.address, HOUR))
        .to.be.revertedWithCustomError(oracle, "NotAContract")
        .withArgs(alice.address);
      await expect(oracle.setFeed(alice.address, feed, HOUR))
        .to.be.revertedWithCustomError(oracle, "NotAContract")
        .withArgs(alice.address);
    });

    it("rejects a zero or over-long staleness window", async function () {
      const feed = await ethFeed.getAddress();
      await expect(oracle.setFeed(ETH, feed, 0)).to.be.revertedWithCustomError(oracle, "InvalidStaleness").withArgs(0);
      const limit = await oracle.MAX_STALENESS_LIMIT();
      await expect(oracle.setFeed(ETH, feed, limit + 1n))
        .to.be.revertedWithCustomError(oracle, "InvalidStaleness")
        .withArgs(limit + 1n);
      await oracle.setFeed(ETH, feed, limit); // the limit itself is allowed
    });

    it("rejects a feed with more than 18 decimals", async function () {
      const feed = await deployFeed(19, 1n);
      await expect(oracle.setFeed(ETH, await feed.getAddress(), HOUR))
        .to.be.revertedWithCustomError(oracle, "UnsupportedDecimals")
        .withArgs(19);
    });

    it("refuses to register a feed that is already stale or invalid", async function () {
      const feed = await deployFeed(8, 0n);
      await expect(oracle.setFeed(ETH, await feed.getAddress(), HOUR)).to.be.revertedWithCustomError(oracle, "InvalidPrice");

      await time.increase(2 * HOUR);
      await expect(oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR)).to.be.revertedWithCustomError(oracle, "StalePrice");
      expect(await oracle.tokenCount()).to.equal(0n); // nothing was half-registered
    });

    it("replaces a feed without duplicating the token, and removes it cleanly", async function () {
      const usdcAddress = await usdc.getAddress();
      const tokenAddress = await token.getAddress();
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      await oracle.setFeed(usdcAddress, await usdcFeed.getAddress(), HOUR);
      await oracle.setFeed(tokenAddress, await ethFeed.getAddress(), HOUR);
      await oracle.setFeed(usdcAddress, await ethFeed.getAddress(), 2 * HOUR); // replace
      expect(await oracle.tokenCount()).to.equal(3n);
      expect((await oracle.feedOf(usdcAddress))[0]).to.equal(await ethFeed.getAddress());

      await expect(oracle.removeFeed(ETH)).to.emit(oracle, "FeedRemoved").withArgs(ETH);
      expect([...(await oracle.tokens())].sort()).to.deep.equal([usdcAddress, tokenAddress].sort());
      expect((await oracle.feedOf(ETH))[0]).to.equal(ethers.ZeroAddress);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "FeedNotSet").withArgs(ETH);

      await oracle.removeFeed(tokenAddress);
      await oracle.removeFeed(usdcAddress);
      expect(await oracle.tokenCount()).to.equal(0n);
      await expect(oracle.removeFeed(usdcAddress)).to.be.revertedWithCustomError(oracle, "FeedNotSet");

      await oracle.setFeed(usdcAddress, await usdcFeed.getAddress(), HOUR); // re-adding works
      expect(await oracle.tokens()).to.deep.equal([usdcAddress]);
    });
  });

  describe("prices", function () {
    it("normalises an 8-decimal answer to 18 decimals and returns the round time", async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      const [price, updatedAt] = await oracle.getPrice(ETH);
      expect(price).to.equal(ethers.parseUnits("2349.5", 18));
      expect(updatedAt).to.equal(await ethFeed.latestTimestamp());
    });

    it("handles 18- and 0-decimal feeds", async function () {
      const f18 = await deployFeed(18, ethers.parseUnits("1.5", 18));
      const f0 = await deployFeed(0, 7n);
      await oracle.setFeed(ETH, await f18.getAddress(), HOUR);
      await oracle.setFeed(await token.getAddress(), await f0.getAddress(), HOUR);
      expect((await oracle.getPrice(ETH))[0]).to.equal(ethers.parseUnits("1.5", 18));
      expect((await oracle.getPrice(await token.getAddress()))[0]).to.equal(ethers.parseUnits("7", 18));
    });

    it("follows the feed when it updates", async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      await ethFeed.updateAnswer(2500_00000000n);
      expect((await oracle.getPrice(ETH))[0]).to.equal(ethers.parseUnits("2500", 18));
    });

    it("values amounts in the token's own decimals", async function () {
      await oracle.setFeed(await usdc.getAddress(), await usdcFeed.getAddress(), HOUR);
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      // 1,000 USDC (6 decimals) at $0.99984576
      expect(await oracle.getValue(await usdc.getAddress(), 1000_000000n)).to.equal(ethers.parseUnits("999.84576", 18));
      // 0.5 ETH at $2,349.50
      expect(await oracle.getValue(ETH, ethers.parseEther("0.5"))).to.equal(ethers.parseUnits("1174.75", 18));
      expect(await oracle.getValue(ETH, 0n)).to.equal(0n);
    });

    it("rounds values down", async function () {
      const feed = await deployFeed(8, 1n); // $0.00000001
      await oracle.setFeed(await usdc.getAddress(), await feed.getAddress(), HOUR);
      // 1 base unit of a 6-decimal token is $1e-14 = 1e4 wei-of-USD, exactly
      expect(await oracle.getValue(await usdc.getAddress(), 1n)).to.equal(10_000n);
      const odd = await deployFeed(8, 3n);
      await oracle.setFeed(await token.getAddress(), await odd.getAddress(), HOUR);
      // 1 base unit of an 18-decimal token at 3e10 (18-dec) price -> 3e10 / 1e18 = 0
      expect(await oracle.getValue(await token.getAddress(), 1n)).to.equal(0n);
    });

    it("does not overflow on very large amounts", async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
      const amount = 10n ** 40n;
      expect(await oracle.getValue(ETH, amount)).to.equal((amount * ethers.parseUnits("2349.5", 18)) / 10n ** 18n);
    });
  });

  describe("validation on read", function () {
    beforeEach(async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
    });

    it("rejects a stale round, with its timestamp and the window", async function () {
      const updatedAt = await ethFeed.latestTimestamp();
      await time.increaseTo(updatedAt + BigInt(HOUR)); // exactly at the limit is still fresh
      await oracle.getPrice(ETH);
      await time.increaseTo(updatedAt + BigInt(HOUR) + 1n);
      await expect(oracle.getPrice(ETH))
        .to.be.revertedWithCustomError(oracle, "StalePrice")
        .withArgs(ETH, updatedAt, HOUR);
      await expect(oracle.getValue(ETH, 1n)).to.be.revertedWithCustomError(oracle, "StalePrice");
    });

    it("rejects zero and negative answers", async function () {
      await ethFeed.updateAnswer(0n);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "InvalidPrice").withArgs(ETH);
      await ethFeed.updateAnswer(-1n);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "InvalidPrice");
    });

    it("rejects a round with no timestamp or a future timestamp", async function () {
      await ethFeed.updateRoundData(2349_50000000n, 0n);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "InvalidPrice");
      await ethFeed.updateRoundData(2349_50000000n, (await time.latest()) + 600);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "InvalidPrice");
    });

    it("turns a reverting feed into InvalidPrice", async function () {
      await ethFeed.setShouldRevert(true);
      await expect(oracle.getPrice(ETH)).to.be.revertedWithCustomError(oracle, "InvalidPrice").withArgs(ETH);
    });

    it("rejects an unregistered token", async function () {
      const address = await token.getAddress();
      await expect(oracle.getPrice(address)).to.be.revertedWithCustomError(oracle, "FeedNotSet").withArgs(address);
      await expect(oracle.getValue(address, 1n)).to.be.revertedWithCustomError(oracle, "FeedNotSet");
    });
  });

  describe("tryGetPrice", function () {
    beforeEach(async function () {
      await oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR);
    });

    it("reports Ok with the price", async function () {
      const [status, price, updatedAt] = await oracle.tryGetPrice(ETH);
      expect(status).to.equal(Status.Ok);
      expect(price).to.equal(ethers.parseUnits("2349.5", 18));
      expect(updatedAt).to.equal(await ethFeed.latestTimestamp());
    });

    it("reports NoFeed for an unknown token", async function () {
      expect(await oracle.tryGetPrice(await token.getAddress())).to.deep.equal([Status.NoFeed, 0n, 0n]);
    });

    it("reports Stale but still returns the last price", async function () {
      await time.increase(HOUR + 1);
      const [status, price] = await oracle.tryGetPrice(ETH);
      expect(status).to.equal(Status.Stale);
      expect(price).to.equal(ethers.parseUnits("2349.5", 18));
    });

    it("reports InvalidPrice for bad answers and reverting feeds, without reverting", async function () {
      await ethFeed.updateAnswer(-5n);
      expect((await oracle.tryGetPrice(ETH))[0]).to.equal(Status.InvalidPrice);
      expect((await oracle.tryGetPrice(ETH))[1]).to.equal(0n);
      await ethFeed.updateAnswer(1n);
      await ethFeed.setShouldRevert(true);
      expect(await oracle.tryGetPrice(ETH)).to.deep.equal([Status.InvalidPrice, 0n, 0n]);
    });
  });

  describe("ownership", function () {
    it("transfers in two steps", async function () {
      await oracle.transferOwnership(alice.address);
      expect(await oracle.owner()).to.equal(owner.address); // not yet
      expect(await oracle.pendingOwner()).to.equal(alice.address);
      await oracle.connect(alice).acceptOwnership();
      expect(await oracle.owner()).to.equal(alice.address);
      await oracle.connect(alice).setFeed(ETH, await ethFeed.getAddress(), HOUR);
      await expect(oracle.setFeed(ETH, await ethFeed.getAddress(), HOUR)).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });
});
