// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AggregatorV3Interface
 * @notice The read interface of a Chainlink Data Feed, identical to the one
 *         Chainlink publishes in its contracts package
 *         (src/v0.8/shared/interfaces/AggregatorV3Interface.sol). Declared
 *         locally so the project does not depend on the whole Chainlink
 *         package for five view functions.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
