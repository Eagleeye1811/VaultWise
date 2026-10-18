// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DexMockERC20
 * @notice Experiment 6 of the VaultWise project — the "MockERC20" of the DEX
 *         experiment sheet: test fuel that ANYONE can mint. Deployed three
 *         times for the demo (Token A, Token B, Token C) so that both single
 *         and multi-hop (A -> B -> C) swaps can be shown.
 *
 * @dev Why a new name
 *      --------------
 *      Experiment 4's `MockERC20` restricts `mint` to its owner, while the DEX
 *      sheet asks for a PUBLIC `mint(to, amount)`. A second contract also
 *      named `MockERC20` would make `getContractFactory("MockERC20")`
 *      ambiguous and break Experiments 4 and 5, so this one is `DexMockERC20`.
 *
 *      The ERC20 of the sheet
 *      ----------------------
 *      The sheet's "ERC20" contract is OpenZeppelin's `ERC20`, which already
 *      does exactly what the sheet lists:
 *        - name, symbol, decimals (18), totalSupply, balanceOf, allowance;
 *        - `transferFrom` lowers a finite allowance by the amount moved and
 *          leaves an allowance of 2^256 - 1 untouched (`_spendAllowance`);
 *        - Transfer and Approval events;
 *        - internal `_mint` and `_burn` (the Pair uses them for LP tokens).
 *
 *      Testnet / classroom code — anyone can mint, so these tokens have no value.
 */
contract DexMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /**
     * @notice Mint test tokens to any address. Public on purpose.
     * @param to     Recipient.
     * @param amount Amount in base units (18 decimals): 1000 tokens = 1000 * 10**18.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
