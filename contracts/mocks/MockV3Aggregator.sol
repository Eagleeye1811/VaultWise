// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../oracle/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockV3Aggregator
 * @notice TEST FIXTURE ONLY — a Chainlink feed whose answer, timestamp and
 *         failure mode are set by the test. Used to drive PriceOracle through
 *         fresh, stale, zero, negative, future-dated and reverting rounds.
 *         Never deployed to a live network.
 */
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    string public override description;
    uint256 public constant override version = 4;

    uint80 public latestRound;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    bool public shouldRevert;

    constructor(uint8 decimals_, int256 initialAnswer, string memory description_) {
        decimals = decimals_;
        description = description_;
        updateAnswer(initialAnswer);
    }

    /// @notice New round with `answer`, timestamped now.
    function updateAnswer(int256 answer) public {
        updateRoundData(answer, block.timestamp);
    }

    /// @notice New round with an explicit timestamp (0 or future to simulate bad rounds).
    function updateRoundData(int256 answer, uint256 timestamp) public {
        latestRound += 1;
        latestAnswer = answer;
        latestTimestamp = timestamp;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function getRoundData(uint80 roundId) external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "MockV3Aggregator: reverted");
        require(roundId == latestRound, "MockV3Aggregator: only the latest round is kept");
        return (roundId, latestAnswer, latestTimestamp, latestTimestamp, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "MockV3Aggregator: reverted");
        return (latestRound, latestAnswer, latestTimestamp, latestTimestamp, latestRound);
    }
}
