// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pair} from "./Pair.sol";

/**
 * @title Factory
 * @notice Experiment 6 of the VaultWise project — the DEX's "assembly line":
 *         it builds exactly one Pair for each token combination and lets
 *         anyone find it. No permission is needed to list a token, which is
 *         what makes the exchange decentralised.
 *
 * @dev Pairs are deployed with CREATE2 using salt keccak256(token0, token1),
 *      so a pair's address depends only on the factory and the sorted tokens.
 *      Token addresses are sorted (token0 < token1), and the pair is stored
 *      under both orderings so `getPair(A, B) == getPair(B, A)`.
 */
contract Factory {
    /// @notice getPair[tokenA][tokenB] — the pair for two tokens, in either order.
    mapping(address => mapping(address => address)) public getPair;

    /// @notice Every pair ever created, in creation order.
    address[] public allPairs;

    /// @notice A new pair was created. `token0 < token1`; `length` is allPairs.length after it.
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 length);

    error IDENTICAL_ADDRESSES();
    error ZERO_ADDRESS();
    error PAIR_EXISTS();

    /// @notice Number of pairs created so far.
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /**
     * @notice Deploy and initialize the Pair for `tokenA` / `tokenB`.
     * @return pair The new Pair's address.
     */
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IDENTICAL_ADDRESSES();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZERO_ADDRESS();
        if (getPair[token0][token1] != address(0)) revert PAIR_EXISTS();

        pair = address(new Pair{salt: keccak256(abi.encodePacked(token0, token1))}());
        Pair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}
