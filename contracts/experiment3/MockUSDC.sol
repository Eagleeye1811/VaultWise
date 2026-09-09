// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Experiment 3 of the VaultWise project — the ERC-20 token that acts as
 *         the *underlying asset* of the VaultWise ERC-4626 vault.
 *
 * @dev Why this contract exists
 *      -------------------------
 *      ERC-4626 is a standard for tokenized vaults, and a tokenized vault is
 *      defined entirely in terms of an underlying ERC-20 asset. Experiment 1's
 *      vault held raw ETH, and ETH is *not* an ERC-20 token — it has no
 *      `approve()`, no `transferFrom()`, no `allowance()`. So an ERC-4626 vault
 *      cannot be built on top of it. Experiment 3 therefore introduces a real
 *      ERC-20 token first, and builds the vault on that.
 *
 *      Everything standard here comes from OpenZeppelin's audited `ERC20`
 *      implementation, which already provides:
 *          totalSupply(), balanceOf(), transfer(), approve(),
 *          allowance(), transferFrom(), and the Transfer / Approval events.
 *      None of that accounting is re-implemented by hand.
 *
 *      Decimals
 *      --------
 *      Real USDC uses 6 decimals, not the 18 that most ERC-20 tokens use, so
 *      this mock uses 6 as well. That is the whole point of the exercise: the
 *      frontend has to convert with `parseUnits(amount, 6)` rather than
 *      `parseEther(amount)`, otherwise "100 USDC" would be sent as 100 of the
 *      smallest units — a factor of one million too small.
 *
 *      OpenZeppelin v5's ERC-4626 reads the underlying token's `decimals()` in
 *      its constructor and derives the share decimals from it, so 6-decimal
 *      assets are fully supported with no workaround needed.
 *
 *      Access control
 *      --------------
 *      `mint()` is deliberately restricted to the deployer (`Ownable`). This is
 *      laboratory scaffolding for handing test balances to a test wallet, not a
 *      DeFi feature — an unrestricted public mint would make the vault's
 *      accounting demonstration meaningless.
 *
 *      This is testnet / classroom code. It has no value and must never be
 *      treated as real USDC.
 */
contract MockUSDC is ERC20, Ownable {
    /// @dev Matches real USDC. See the decimals note above.
    uint8 private constant _DECIMALS = 6;

    /**
     * @notice Deploys the token and makes the deployer its owner.
     * @dev Takes no constructor arguments so it can be deployed in Remix with a
     *      single click, which is how the rest of VaultWise is deployed.
     */
    constructor() ERC20("Mock USDC", "USDC") Ownable(msg.sender) {}

    /**
     * @notice Number of decimals used by this token.
     * @return Always 6, mirroring real USDC.
     * @dev Overriding `decimals()` is the standard, supported ERC-20 way to
     *      change this — OpenZeppelin documents this exact override.
     */
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /**
     * @notice Mint test tokens to an address.
     * @param to     Recipient of the newly minted tokens.
     * @param amount Amount in the token's smallest unit (6 decimals), so
     *               1000 USDC is `1000_000000`.
     * @dev Owner-only. Emits the standard ERC-20 `Transfer` event from the
     *      zero address, which is what a mint looks like on-chain.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
