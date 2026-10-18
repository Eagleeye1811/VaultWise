// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title HostileERC20 — TEST FIXTURE ONLY, never deploy
 * @notice A misbehaving 18-decimal ERC-20 used by `test/experiment5.test.js` to
 *         prove SimpleYieldFarm and SimpleStaking survive non-standard tokens.
 *         One behaviour at a time:
 *
 *           Reenter      on the next transfer/transferFrom, call `target` with
 *                        `payload` first and bubble up its revert
 *           Fee          burn `feeBps` of every transfer (fee-on-transfer)
 *           ReturnFalse  transfer/transferFrom return false and move nothing
 *
 * @dev Not part of Experiment 5's deliverable, which remains MockERC20.sol plus
 *      SimpleYieldFarm.sol / SimpleStaking.sol. `ReentrantERC20` (Experiment 4)
 *      is left untouched because it only hooks `transferFrom`, and reward
 *      payouts go through `transfer`.
 */
contract HostileERC20 is ERC20 {
    enum Mode {
        None,
        Reenter,
        Fee,
        ReturnFalse
    }

    Mode public mode;
    address public target;
    bytes public payload;
    uint256 public feeBps;

    constructor() ERC20("Hostile Token", "HOST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReenter(address target_, bytes calldata payload_) external {
        mode = Mode.Reenter;
        target = target_;
        payload = payload_;
    }

    function setFee(uint256 feeBps_) external {
        mode = Mode.Fee;
        feeBps = feeBps_;
    }

    function setReturnFalse() external {
        mode = Mode.ReturnFalse;
    }

    /// @notice Back to a normal ERC-20. Needed after a reverted re-entry,
    ///         because the revert also rolls back the hook's own disarm.
    function disarm() external {
        mode = Mode.None;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (_beforeMove()) return false;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (_beforeMove()) return false;
        return super.transferFrom(from, to, value);
    }

    /// @dev Burns the fee out of every wallet-to-wallet move in Fee mode.
    function _update(address from, address to, uint256 value) internal override {
        if (mode == Mode.Fee && from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
            return;
        }
        super._update(from, to, value);
    }

    /// @return refuse true when the move must report failure without happening.
    function _beforeMove() private returns (bool refuse) {
        if (mode == Mode.ReturnFalse) return true;
        if (mode == Mode.Reenter) {
            mode = Mode.None;
            (bool ok, bytes memory reason) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        return false;
    }
}
