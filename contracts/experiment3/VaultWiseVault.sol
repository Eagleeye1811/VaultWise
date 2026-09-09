// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title VaultWiseVault (Experiment 3 — ERC-4626)
 * @notice The tokenized VaultWise vault. Users deposit `MockUSDC` and receive
 *         transferable ERC-20 vault shares (`vwUSDC`) that represent their
 *         claim on the vault's assets.
 *
 * @dev How this differs from Experiment 1
 *      ----------------------------------
 *      Experiment 1's vault held ETH and tracked ownership in a hand-written
 *      `mapping(address => uint256) deposits`. That works, but the position is
 *      invisible to the rest of the ecosystem: it cannot be transferred, used
 *      as collateral, or read by any other protocol.
 *
 *      ERC-4626 replaces that mapping with *shares*, which are themselves an
 *      ERC-20 token. Ownership of a vault position becomes a real token
 *      balance. That is the entire point of the standard, so this contract
 *      keeps **no** deposit mapping of its own — a second ledger alongside the
 *      share supply would be double accounting and the two would drift apart.
 *
 *      What is inherited, not rewritten
 *      --------------------------------
 *      Every piece of vault accounting comes from OpenZeppelin's audited
 *      `ERC4626`, and none of it is overridden here:
 *
 *        asset()             totalAssets()
 *        deposit()           previewDeposit()      maxDeposit()
 *        mint()              previewMint()         maxMint()
 *        withdraw()          previewWithdraw()     maxWithdraw()
 *        redeem()            previewRedeem()       maxRedeem()
 *        convertToShares()   convertToAssets()
 *
 *      plus the inherited ERC-20 behaviour of the shares themselves —
 *      `balanceOf`, `totalSupply`, `transfer`, `approve`, `allowance`,
 *      `transferFrom`, and the `Transfer` / `Approval` events. The shares are
 *      deliberately left freely transferable (not soulbound), because an
 *      ERC-4626 share that cannot move is not an ERC-4626 share.
 *
 *      Decimals
 *      --------
 *      `ERC4626`'s constructor reads `decimals()` from the underlying asset, so
 *      with 6-decimal `MockUSDC` the shares are also 6 decimals. No override is
 *      needed and none is added.
 *
 *      OpenZeppelin v5 defends against the classic "donation" / share-inflation
 *      attack with virtual assets and shares rather than with custom code, so
 *      an empty vault still converts 1 asset to 1 share exactly, which keeps
 *      the numbers in this experiment easy to read.
 *
 *      Testnet / classroom code. Never use with real funds.
 */
contract VaultWiseVault is ERC4626 {
    // ---------------------------------------------------------------------
    // VaultWise-specific feature: the Vault Profile
    //
    // This is the one application-specific addition allowed by Experiment 3.
    // It is pure, read-only metadata: it writes no storage after deployment,
    // touches no balance, and is never consulted by any ERC-4626 function. The
    // asset/share accounting behaves exactly as the standard specifies with or
    // without it.
    //
    // Why it is VaultWise-specific rather than generic ERC-4626 boilerplate:
    // VaultWise is a multi-vault product. Later experiments add more vaults
    // with different assets and different mandates, and the React frontend has
    // no backend and no database to describe them with. Without on-chain
    // metadata the UI can only show an address. `vaultProfile()` lets the
    // frontend render a self-describing vault card — what this vault is for,
    // what it holds, and how to read its risk — from one RPC call, with the
    // description living next to the vault it describes instead of drifting
    // out of sync in the frontend bundle.
    // ---------------------------------------------------------------------

    /// @notice Human-readable name of this specific VaultWise vault.
    string public constant VAULT_LABEL = "VaultWise Core USDC Vault";

    /// @notice Product category this vault belongs to inside VaultWise.
    string public constant VAULT_CATEGORY = "Stablecoin Treasury";

    /// @notice Plain-language risk statement shown to the user before deposit.
    string public constant VAULT_RISK_NOTE =
        "Educational testnet vault. Principal only: no yield strategy is attached, so 1 share stays worth ~1 USDC. Never deposit real funds.";

    /// @notice Which VaultWise experiment introduced this contract.
    string public constant VAULT_EXPERIMENT =
        "Experiment 3 - ERC-4626 Tokenized Vault";

    /**
     * @notice Everything the VaultWise UI needs to describe this vault.
     * @param label         Human-readable vault name.
     * @param category      VaultWise product category.
     * @param riskNote      Plain-language risk statement.
     * @param experiment    Originating VaultWise experiment.
     * @param assetAddress  The underlying ERC-20 asset (same as `asset()`).
     * @param assetSymbol   Symbol of the underlying asset, e.g. "USDC".
     * @param shareSymbol   Symbol of the vault share token, e.g. "vwUSDC".
     * @param assetDecimals Decimals of the underlying asset.
     * @param shareDecimals Decimals of the vault share token.
     */
    struct Profile {
        string label;
        string category;
        string riskNote;
        string experiment;
        address assetAddress;
        string assetSymbol;
        string shareSymbol;
        uint8 assetDecimals;
        uint8 shareDecimals;
    }

    /**
     * @notice Deploy the vault on top of an existing ERC-20 asset.
     * @param asset_ The underlying ERC-20 token — `MockUSDC` for Experiment 3.
     * @dev `ERC20(...)` names the *share* token; `ERC4626(asset_)` wires up the
     *      underlying asset and reads its decimals. The single constructor
     *      argument keeps Remix deployment to one pasted address.
     */
    constructor(IERC20 asset_)
        ERC20("VaultWise Vault Share", "vwUSDC")
        ERC4626(asset_)
    {}

    /**
     * @notice Read this vault's VaultWise profile plus its live token details.
     * @return The populated {Profile} struct.
     * @dev View-only. The symbol/decimals fields are read live from the
     *      underlying asset so they can never disagree with `asset()`.
     */
    function vaultProfile() external view returns (Profile memory) {
        IERC20Metadata underlying = IERC20Metadata(asset());

        return
            Profile({
                label: VAULT_LABEL,
                category: VAULT_CATEGORY,
                riskNote: VAULT_RISK_NOTE,
                experiment: VAULT_EXPERIMENT,
                assetAddress: address(underlying),
                assetSymbol: underlying.symbol(),
                shareSymbol: symbol(),
                assetDecimals: underlying.decimals(),
                shareDecimals: decimals()
            });
    }
}
