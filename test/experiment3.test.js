import { expect } from "chai";
import { network } from "hardhat";

/**
 * VaultWise — Experiment 3 test suite
 * ===================================
 *
 * Walks the exact lifecycle required by the experiment brief, in order:
 *
 *   1  MockUSDC deployment            10  totalAssets() after deposit
 *   2  MockUSDC mint                  11  totalSupply() after deposit
 *   3  Vault deployment               12  convertToShares()
 *   4  asset()                        13  convertToAssets()
 *   5  initial totalAssets()          14  mint()
 *   6  ERC-20 approval                15  withdraw()
 *   7  allowance()                    16  redeem()
 *   8  deposit()                      17  underlying assets returned
 *   9  vault shares received          18  ERC-20 + ERC-4626 events
 *
 * Plus the ERC-4626 limit functions, the ERC-20 behaviour of the shares
 * themselves, and the VaultWise vault-profile feature.
 */

const { ethers } = await network.getOrCreate();

/** MockUSDC has 6 decimals, so "100 USDC" is 100_000000 base units. */
const USDC = (amount) => ethers.parseUnits(String(amount), 6);

/** Vault shares inherit the asset's 6 decimals from ERC4626. */
const SHARES = (amount) => ethers.parseUnits(String(amount), 6);

/** Fully qualified — Experiment 1 also has a contract called VaultWiseVault. */
const VAULT_FQN = "contracts/experiment3/VaultWiseVault.sol:VaultWiseVault";

describe("VaultWise Experiment 3 — ERC-20 + ERC-4626", function () {
  let usdc;
  let vault;
  let deployer;
  let user;
  let other;

  /**
   * Fresh contracts for every test so no test can depend on another's state.
   * Deployment order is the order the experiment requires:
   * MockUSDC -> mint -> vault.
   */
  beforeEach(async function () {
    [deployer, user, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Step 2 of the brief: 1000 USDC to the test wallet.
    await usdc.mint(user.address, USDC(1000));

    const VaultWiseVault = await ethers.getContractFactory(VAULT_FQN);
    vault = await VaultWiseVault.deploy(await usdc.getAddress());
    await vault.waitForDeployment();
  });

  /** Approve + deposit `amount` USDC from `user`. Used by later steps. */
  async function depositAs(signer, amount) {
    await usdc.connect(signer).approve(await vault.getAddress(), amount);
    return vault.connect(signer).deposit(amount, signer.address);
  }

  // ===================================================================
  // 1. MockUSDC deployment
  // ===================================================================
  describe("1. MockUSDC deployment", function () {
    it("deploys with the expected name, symbol and 6 decimals", async function () {
      expect(await usdc.name()).to.equal("Mock USDC");
      expect(await usdc.symbol()).to.equal("USDC");
      expect(await usdc.decimals()).to.equal(6n);
    });

    it("has a real address and makes the deployer the owner", async function () {
      expect(await usdc.getAddress()).to.properAddress;
      expect(await usdc.owner()).to.equal(deployer.address);
    });
  });

  // ===================================================================
  // 2. MockUSDC mint
  // ===================================================================
  describe("2. MockUSDC mint", function () {
    it("credits 1000 USDC to the test wallet and raises totalSupply", async function () {
      expect(await usdc.balanceOf(user.address)).to.equal(USDC(1000));
      expect(await usdc.totalSupply()).to.equal(USDC(1000));
    });

    it("mints 1000 USDC as 1000000000 base units, not 1000", async function () {
      // The decimals trap the brief calls out: 1000 USDC must never be sent
      // as 1000 smallest units.
      expect(await usdc.balanceOf(user.address)).to.equal(1_000_000_000n);
    });

    it("emits Transfer from the zero address", async function () {
      await expect(usdc.mint(other.address, USDC(5)))
        .to.emit(usdc, "Transfer")
        .withArgs(ethers.ZeroAddress, other.address, USDC(5));
    });

    it("rejects mint from a non-owner", async function () {
      await expect(
        usdc.connect(user).mint(user.address, USDC(1))
      ).to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  // ===================================================================
  // 3. Vault deployment
  // ===================================================================
  describe("3. Vault deployment", function () {
    it("deploys with the VaultWise share name and symbol", async function () {
      expect(await vault.name()).to.equal("VaultWise Vault Share");
      expect(await vault.symbol()).to.equal("vwUSDC");
    });

    it("inherits the underlying asset's 6 decimals", async function () {
      expect(await vault.decimals()).to.equal(6n);
    });

    it("starts with zero shares in circulation", async function () {
      expect(await vault.totalSupply()).to.equal(0n);
    });
  });

  // ===================================================================
  // 4. asset()
  // ===================================================================
  describe("4. asset()", function () {
    it("returns the MockUSDC contract address", async function () {
      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });
  });

  // ===================================================================
  // 5. Initial totalAssets()
  // ===================================================================
  describe("5. Initial totalAssets()", function () {
    it("is zero before any deposit", async function () {
      expect(await vault.totalAssets()).to.equal(0n);
    });
  });

  // ===================================================================
  // 6 & 7. ERC-20 approval and allowance
  // ===================================================================
  describe("6 & 7. approve() and allowance()", function () {
    it("records the allowance the user granted to the vault", async function () {
      await usdc.connect(user).approve(await vault.getAddress(), USDC(100));
      expect(
        await usdc.allowance(user.address, await vault.getAddress())
      ).to.equal(USDC(100));
    });

    it("emits Approval with the correct arguments", async function () {
      await expect(usdc.connect(user).approve(await vault.getAddress(), USDC(100)))
        .to.emit(usdc, "Approval")
        .withArgs(user.address, await vault.getAddress(), USDC(100));
    });

    it("blocks a deposit that has no allowance", async function () {
      // This is why approval is required: the vault pulls the tokens with
      // transferFrom, which the ERC-20 refuses without an allowance.
      await expect(
        vault.connect(user).deposit(USDC(100), user.address)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });
  });

  // ===================================================================
  // 8 & 9. deposit() and shares received
  // ===================================================================
  describe("8 & 9. deposit() and vault shares received", function () {
    it("previewDeposit matches the shares actually minted", async function () {
      const expected = await vault.previewDeposit(USDC(100));
      await depositAs(user, USDC(100));
      expect(await vault.balanceOf(user.address)).to.equal(expected);
    });

    it("mints 1 share per asset into an empty vault", async function () {
      await depositAs(user, USDC(100));
      expect(await vault.balanceOf(user.address)).to.equal(SHARES(100));
    });

    it("moves the USDC out of the user and into the vault", async function () {
      await depositAs(user, USDC(100));
      expect(await usdc.balanceOf(user.address)).to.equal(USDC(900));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(100));
    });

    it("spends the allowance it used", async function () {
      await depositAs(user, USDC(100));
      expect(
        await usdc.allowance(user.address, await vault.getAddress())
      ).to.equal(0n);
    });
  });

  // ===================================================================
  // 10 & 11. totalAssets() and totalSupply() after a deposit
  // ===================================================================
  describe("10 & 11. totalAssets() and totalSupply()", function () {
    it("both rise by the deposited amount", async function () {
      await depositAs(user, USDC(100));
      expect(await vault.totalAssets()).to.equal(USDC(100));
      expect(await vault.totalSupply()).to.equal(SHARES(100));
    });

    it("totalAssets() tracks the vault's real token balance", async function () {
      await depositAs(user, USDC(250));
      expect(await vault.totalAssets()).to.equal(
        await usdc.balanceOf(await vault.getAddress())
      );
    });

    it("keeps a single ledger — share supply equals the sum of balances", async function () {
      await usdc.mint(other.address, USDC(500));
      await depositAs(user, USDC(100));
      await depositAs(other, USDC(400));

      const sum =
        (await vault.balanceOf(user.address)) +
        (await vault.balanceOf(other.address));
      expect(await vault.totalSupply()).to.equal(sum);
    });
  });

  // ===================================================================
  // 12 & 13. convertToShares() / convertToAssets()
  // ===================================================================
  describe("12 & 13. convertToShares() and convertToAssets()", function () {
    it("converts 1:1 while the vault holds no yield", async function () {
      expect(await vault.convertToShares(USDC(100))).to.equal(SHARES(100));
      expect(await vault.convertToAssets(SHARES(100))).to.equal(USDC(100));
    });

    it("round-trips a value back to itself", async function () {
      await depositAs(user, USDC(300));
      const shares = await vault.convertToShares(USDC(75));
      expect(await vault.convertToAssets(shares)).to.equal(USDC(75));
    });

    it("re-prices shares upward when the vault gains assets", async function () {
      await depositAs(user, USDC(100));

      // Simulate yield by sending USDC straight to the vault. No shares are
      // minted for it, so every existing share is now worth more. This is
      // exactly the accounting ERC-4626 exists to express.
      await usdc.mint(deployer.address, USDC(100));
      await usdc.connect(deployer).transfer(await vault.getAddress(), USDC(100));

      expect(await vault.totalAssets()).to.equal(USDC(200));
      expect(await vault.totalSupply()).to.equal(SHARES(100));

      // 100 shares now claim ~200 USDC (rounded down in the vault's favour).
      const assets = await vault.convertToAssets(SHARES(100));
      expect(assets).to.be.greaterThan(USDC(199));
      expect(assets).to.be.lessThanOrEqual(USDC(200));

      // And a fresh 100 USDC now buys roughly half as many shares.
      const sharesForHundred = await vault.convertToShares(USDC(100));
      expect(sharesForHundred).to.be.lessThan(SHARES(51));
      expect(sharesForHundred).to.be.greaterThan(SHARES(49));
    });
  });

  // ===================================================================
  // 14. mint()
  // ===================================================================
  describe("14. mint()", function () {
    it("previewMint reports the assets required for a share count", async function () {
      expect(await vault.previewMint(SHARES(50))).to.equal(USDC(50));
    });

    it("mints exactly the requested shares and pulls the required assets", async function () {
      const cost = await vault.previewMint(SHARES(50));
      await usdc.connect(user).approve(await vault.getAddress(), cost);
      await vault.connect(user).mint(SHARES(50), user.address);

      expect(await vault.balanceOf(user.address)).to.equal(SHARES(50));
      expect(await usdc.balanceOf(user.address)).to.equal(USDC(1000) - cost);
      expect(await vault.totalAssets()).to.equal(cost);
    });

    it("differs from deposit() in what the caller fixes", async function () {
      // deposit(): caller fixes the ASSETS in, shares out are derived.
      // mint():    caller fixes the SHARES out, assets in are derived.
      const sharesFromDeposit = await vault.previewDeposit(USDC(40));
      const assetsForMint = await vault.previewMint(SHARES(40));
      expect(sharesFromDeposit).to.equal(SHARES(40));
      expect(assetsForMint).to.equal(USDC(40));
    });
  });

  // ===================================================================
  // 15 & 17. withdraw() and assets returned
  // ===================================================================
  describe("15 & 17. withdraw()", function () {
    beforeEach(async function () {
      await depositAs(user, USDC(100));
    });

    it("previewWithdraw reports the shares that will burn", async function () {
      expect(await vault.previewWithdraw(USDC(30))).to.equal(SHARES(30));
    });

    it("returns the exact assets asked for and burns the matching shares", async function () {
      await vault.connect(user).withdraw(USDC(30), user.address, user.address);

      expect(await usdc.balanceOf(user.address)).to.equal(USDC(930));
      expect(await vault.balanceOf(user.address)).to.equal(SHARES(70));
      expect(await vault.totalAssets()).to.equal(USDC(70));
      expect(await vault.totalSupply()).to.equal(SHARES(70));
    });

    it("refuses to withdraw more than the user's shares can claim", async function () {
      await expect(
        vault.connect(user).withdraw(USDC(200), user.address, user.address)
      ).to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxWithdraw");
    });
  });

  // ===================================================================
  // 16 & 17. redeem() and assets returned
  // ===================================================================
  describe("16 & 17. redeem()", function () {
    beforeEach(async function () {
      await depositAs(user, USDC(100));
    });

    it("previewRedeem reports the assets that will come back", async function () {
      expect(await vault.previewRedeem(SHARES(20))).to.equal(USDC(20));
    });

    it("burns the exact shares given and returns the underlying USDC", async function () {
      await vault.connect(user).redeem(SHARES(20), user.address, user.address);

      expect(await vault.balanceOf(user.address)).to.equal(SHARES(80));
      expect(await usdc.balanceOf(user.address)).to.equal(USDC(920));
      expect(await vault.totalSupply()).to.equal(SHARES(80));
      expect(await vault.totalAssets()).to.equal(USDC(80));
    });

    it("redeeming every share empties the position and the vault", async function () {
      const all = await vault.balanceOf(user.address);
      await vault.connect(user).redeem(all, user.address, user.address);

      expect(await vault.balanceOf(user.address)).to.equal(0n);
      expect(await vault.totalSupply()).to.equal(0n);
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await usdc.balanceOf(user.address)).to.equal(USDC(1000));
    });

    it("differs from withdraw() in what the caller fixes", async function () {
      // withdraw(): caller fixes the ASSETS out, shares burned are derived.
      // redeem():   caller fixes the SHARES burned, assets out are derived.
      expect(await vault.previewWithdraw(USDC(25))).to.equal(SHARES(25));
      expect(await vault.previewRedeem(SHARES(25))).to.equal(USDC(25));
    });

    it("refuses to redeem more shares than the user holds", async function () {
      await expect(
        vault.connect(user).redeem(SHARES(200), user.address, user.address)
      ).to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxRedeem");
    });
  });

  // ===================================================================
  // 18. Events — ERC-20 and ERC-4626
  // ===================================================================
  describe("18. Events", function () {
    it("deposit() emits the ERC-4626 Deposit event", async function () {
      await usdc.connect(user).approve(await vault.getAddress(), USDC(100));
      await expect(vault.connect(user).deposit(USDC(100), user.address))
        .to.emit(vault, "Deposit")
        .withArgs(user.address, user.address, USDC(100), SHARES(100));
    });

    it("deposit() also emits the ERC-20 Transfer that mints the shares", async function () {
      await usdc.connect(user).approve(await vault.getAddress(), USDC(100));
      await expect(vault.connect(user).deposit(USDC(100), user.address))
        .to.emit(vault, "Transfer")
        .withArgs(ethers.ZeroAddress, user.address, SHARES(100));
    });

    it("deposit() moves the assets with an ERC-20 Transfer on MockUSDC", async function () {
      await usdc.connect(user).approve(await vault.getAddress(), USDC(100));
      await expect(vault.connect(user).deposit(USDC(100), user.address))
        .to.emit(usdc, "Transfer")
        .withArgs(user.address, await vault.getAddress(), USDC(100));
    });

    it("withdraw() emits the ERC-4626 Withdraw event", async function () {
      await depositAs(user, USDC(100));
      await expect(
        vault.connect(user).withdraw(USDC(30), user.address, user.address)
      )
        .to.emit(vault, "Withdraw")
        .withArgs(user.address, user.address, user.address, USDC(30), SHARES(30));
    });

    it("redeem() emits Withdraw and burns shares with a Transfer to zero", async function () {
      await depositAs(user, USDC(100));
      const tx = vault.connect(user).redeem(SHARES(20), user.address, user.address);

      await expect(tx)
        .to.emit(vault, "Withdraw")
        .withArgs(user.address, user.address, user.address, USDC(20), SHARES(20));
      await expect(tx)
        .to.emit(vault, "Transfer")
        .withArgs(user.address, ethers.ZeroAddress, SHARES(20));
    });
  });

  // ===================================================================
  // ERC-4626 limit functions
  // ===================================================================
  describe("Limit functions", function () {
    it("maxDeposit and maxMint are unbounded for this vault", async function () {
      expect(await vault.maxDeposit(user.address)).to.equal(ethers.MaxUint256);
      expect(await vault.maxMint(user.address)).to.equal(ethers.MaxUint256);
    });

    it("maxWithdraw and maxRedeem reflect what the user actually holds", async function () {
      expect(await vault.maxWithdraw(user.address)).to.equal(0n);
      expect(await vault.maxRedeem(user.address)).to.equal(0n);

      await depositAs(user, USDC(100));

      expect(await vault.maxWithdraw(user.address)).to.equal(USDC(100));
      expect(await vault.maxRedeem(user.address)).to.equal(SHARES(100));
    });
  });

  // ===================================================================
  // Vault shares must stay ERC-20 compatible (not soulbound)
  // ===================================================================
  describe("Vault shares as an ERC-20 token", function () {
    beforeEach(async function () {
      await depositAs(user, USDC(100));
    });

    it("shares can be transferred to another account", async function () {
      await vault.connect(user).transfer(other.address, SHARES(40));
      expect(await vault.balanceOf(user.address)).to.equal(SHARES(60));
      expect(await vault.balanceOf(other.address)).to.equal(SHARES(40));
    });

    it("shares support approve / allowance / transferFrom", async function () {
      await vault.connect(user).approve(other.address, SHARES(25));
      expect(await vault.allowance(user.address, other.address)).to.equal(SHARES(25));

      await vault.connect(other).transferFrom(user.address, other.address, SHARES(25));
      expect(await vault.balanceOf(other.address)).to.equal(SHARES(25));
      expect(await vault.allowance(user.address, other.address)).to.equal(0n);
    });

    it("a transferred share carries the claim on the assets with it", async function () {
      await vault.connect(user).transfer(other.address, SHARES(40));
      await vault.connect(other).redeem(SHARES(40), other.address, other.address);
      expect(await usdc.balanceOf(other.address)).to.equal(USDC(40));
    });
  });

  // ===================================================================
  // VaultWise-specific feature: the vault profile
  // ===================================================================
  describe("VaultWise feature — vaultProfile()", function () {
    it("returns the VaultWise metadata alongside live token details", async function () {
      const p = await vault.vaultProfile();

      expect(p.label).to.equal("VaultWise Core USDC Vault");
      expect(p.category).to.equal("Stablecoin Treasury");
      expect(p.experiment).to.equal("Experiment 3 - ERC-4626 Tokenized Vault");
      expect(p.riskNote).to.contain("Educational testnet vault");

      expect(p.assetAddress).to.equal(await usdc.getAddress());
      expect(p.assetSymbol).to.equal("USDC");
      expect(p.shareSymbol).to.equal("vwUSDC");
      expect(p.assetDecimals).to.equal(6n);
      expect(p.shareDecimals).to.equal(6n);
    });

    it("agrees with asset() and never disagrees with it", async function () {
      const p = await vault.vaultProfile();
      expect(p.assetAddress).to.equal(await vault.asset());
    });

    it("does not disturb share accounting", async function () {
      await depositAs(user, USDC(100));
      const before = {
        assets: await vault.totalAssets(),
        supply: await vault.totalSupply(),
        shares: await vault.balanceOf(user.address),
      };

      await vault.vaultProfile();

      expect(await vault.totalAssets()).to.equal(before.assets);
      expect(await vault.totalSupply()).to.equal(before.supply);
      expect(await vault.balanceOf(user.address)).to.equal(before.shares);
    });
  });
});
