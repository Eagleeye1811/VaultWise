// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @notice Experiment 4 of the VaultWise project — a generic test token. The
 *         SAME contract is deployed twice to create the two assets of the
 *         liquidity pool:
 *
 *             Deployment 1:  MockERC20("Token A", "TKA")
 *             Deployment 2:  MockERC20("Token B", "TKB")
 *
 * @dev Why one contract, deployed twice
 *      ---------------------------------
 *      Token A and Token B do not need different behaviour — an AMM only cares
 *      that both sides of the pool are ERC-20s. Taking the name and symbol as
 *      constructor arguments lets one audited-by-inheritance source file
 *      produce both, exactly as the experiment sheet prescribes.
 *
 *      Everything standard comes from OpenZeppelin's `ERC20`:
 *          totalSupply(), balanceOf(), transfer(), approve(),
 *          allowance(), transferFrom(), and the Transfer / Approval events.
 *      `transferFrom` is the function SimpleAMM uses to pull approved tokens
 *      out of a provider's or trader's wallet.
 *
 *      Decimals and base units
 *      -----------------------
 *      This token keeps OpenZeppelin's default of **18 decimals** (no override).
 *      Every on-chain amount is an integer number of the *smallest unit*, so:
 *
 *          1 TKA      = 1 * 10^18  = 1000000000000000000 base units
 *          1000 TKA   = 1000 * 10^18 = 1000000000000000000000 base units
 *
 *      When calling `mint`, `approve`, `addLiquidity` or a swap from Remix you
 *      must type the base-unit number. The VaultWise frontend converts for you
 *      with `parseUnits(amount, decimals)`, reading `decimals()` from the chain.
 *
 *      Both pool tokens use the same 18 decimals on purpose. SimpleAMM's
 *      constant-product maths works on raw integers and does not rescale
 *      between tokens, so keeping the two sides in compatible units makes the
 *      reserve ratio read directly as a price.
 *
 *      Access control
 *      --------------
 *      `mint()` is restricted to the deployer via OpenZeppelin `Ownable`. This
 *      is laboratory scaffolding for funding test accounts — an unrestricted
 *      public mint would let anyone create unlimited pool assets.
 *
 *      Testnet / classroom code. These tokens have no value.
 */
contract MockERC20 is ERC20, Ownable {
    /**
     * @notice Deploy a test token and make the deployer its owner.
     * @param name_   Full token name, e.g. "Token A".
     * @param symbol_ Ticker symbol, e.g. "TKA".
     */
    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {}

    /**
     * @notice Mint test tokens to an address.
     * @param to     Recipient of the newly minted tokens.
     * @param amount Amount in base units (18 decimals), so 1000 tokens is
     *               `1000 * 10**18`.
     * @dev Owner-only. Emits the standard ERC-20 `Transfer(address(0), to, amount)`.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
