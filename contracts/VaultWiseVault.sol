// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VaultWiseVault
 * @notice Experiment 1 of the VaultWise project — a minimal, educational ETH vault.
 *
 * @dev What this contract does:
 *      - Users send ETH to the vault with `deposit()`.
 *      - The vault records how much each user personally deposited.
 *      - Users can pull their own ETH back out with `withdraw(amount)`,
 *        but never more than they themselves deposited.
 *
 *      What this contract intentionally does NOT do (later experiments):
 *      - No ERC-20 / ERC-4626 shares, no tokens, no yield, no strategies,
 *        no AMM, no staking, no governance, no oracles.
 *
 *      Safety notes for an educational contract:
 *      - Uses checks-effects-interactions: all state is updated *before*
 *        any ETH is sent out, so a re-entrant call sees the already-reduced
 *        balance and cannot drain the vault.
 *      - Uses `call` for the ETH transfer (the recommended pattern since the
 *        gas cost of opcodes can change, which breaks `transfer`/`send`).
 *      - Solidity >=0.8 has built-in overflow/underflow checks, so no SafeMath.
 *
 *      This is testnet / classroom code. Do not use with real funds.
 */
contract VaultWiseVault {
    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice ETH (in wei) currently credited to each depositor.
    mapping(address => uint256) public deposits;

    /// @notice Sum of every user's credited balance (in wei).
    uint256 public totalDeposits;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a user deposits ETH into the vault.
    event Deposited(address indexed user, uint256 amount);

    /// @notice Emitted when a user withdraws ETH from the vault.
    event Withdrawn(address indexed user, uint256 amount);

    // ---------------------------------------------------------------------
    // Write functions
    // ---------------------------------------------------------------------

    /**
     * @notice Deposit ETH into the vault.
     * @dev The amount deposited is `msg.value`; it must be greater than zero.
     *      Credited to the caller and added to the vault total.
     */
    function deposit() external payable {
        require(msg.value > 0, "Deposit amount must be greater than zero");

        // Effects
        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw part or all of your own deposited ETH.
     * @param amount Amount to withdraw, in wei.
     * @dev Checks-effects-interactions: balances are reduced before the
     *      ETH transfer, which makes re-entrancy useless to an attacker.
     */
    function withdraw(uint256 amount) external {
        // Checks
        require(amount > 0, "Withdraw amount must be greater than zero");
        require(deposits[msg.sender] >= amount, "Insufficient vault balance");

        // Effects (state updated BEFORE the external call)
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;

        // Interactions
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Read functions
    // ---------------------------------------------------------------------

    /**
     * @notice How much ETH the caller currently has in the vault.
     * @return The caller's credited balance, in wei.
     */
    function getMyDeposit() external view returns (uint256) {
        return deposits[msg.sender];
    }

    /**
     * @notice Total ETH actually held by this contract.
     * @return The contract's ETH balance, in wei.
     */
    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ---------------------------------------------------------------------
    // Fallbacks
    // ---------------------------------------------------------------------

    /**
     * @dev Plain ETH transfers are rejected on purpose. A raw `send` would
     *      add ETH to the contract without crediting anyone, so we force
     *      users through `deposit()` where the accounting happens.
     */
    receive() external payable {
        revert("Use deposit() to add ETH");
    }

    fallback() external payable {
        revert("Unknown function; use deposit() or withdraw()");
    }
}
