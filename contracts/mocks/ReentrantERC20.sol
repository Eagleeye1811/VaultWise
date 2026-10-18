// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ReentrantERC20 — TEST FIXTURE ONLY, never deploy
 * @notice A hostile ERC-20 used by `test/experiment4.test.js` to prove that
 *         SimpleAMM's reentrancy guard holds. When armed, its `transferFrom`
 *         calls back into a target contract (the pool) before moving tokens,
 *         and bubbles up whatever that call reverts with.
 *
 * @dev This is not part of Experiment 4's deliverable, which remains exactly
 *      two Solidity sources (MockERC20.sol and SimpleAMM.sol). It exists only
 *      because a reentrancy test needs a token that misbehaves.
 */
contract ReentrantERC20 is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;

    constructor() ERC20("Reentrant Token", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice On the next `transferFrom`, call `target` with `payload` first.
    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok, bytes memory reason) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        return super.transferFrom(from, to, value);
    }
}
