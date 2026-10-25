// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @notice VaultWise's USD price source: a registry that maps each platform
 *         token to a Chainlink Data Feed and returns validated prices.
 *
 * @dev Every price is normalised to 18 decimals (1e18 = $1), whatever the
 *      feed's own precision, so callers never handle feed decimals.
 *
 *      Validation on every read:
 *        - a feed must be registered for the token        (FeedNotSet)
 *        - the answer must be positive, and the round must
 *          have a timestamp that is not in the future       (InvalidPrice)
 *        - the round must be newer than the token's
 *          `maxStaleness`, set per feed from its heartbeat   (StalePrice)
 *      A feed that reverts is reported as an invalid price rather than
 *      bubbling an arbitrary error.
 *
 *      `getPrice` / `getValue` revert on any failed check, which is what an
 *      on-chain consumer wants. `tryGetPrice` never reverts and returns a
 *      status instead, for dashboards that read many tokens at once.
 *
 *      Native ETH has no token address, so it is registered under the
 *      conventional sentinel `ETH` (0xEeee…EEeE).
 *
 *      The owner can add, replace or remove feeds. That is the only
 *      privileged power, and ownership changes take two steps
 *      (`transferOwnership` + `acceptOwnership`) so it cannot be handed to a
 *      mistyped address.
 */
contract PriceOracle is Ownable2Step {
    /// @notice Sentinel address under which native ETH is priced.
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @notice Decimals of every price this contract returns.
    uint8 public constant PRICE_DECIMALS = 18;

    /// @notice Upper bound on a feed's staleness window. Chainlink's slowest
    ///         heartbeat is 24 h, so anything past a week is a configuration mistake.
    uint32 public constant MAX_STALENESS_LIMIT = 7 days;

    /// @notice Result of a non-reverting read.
    enum Status {
        Ok,
        NoFeed,
        InvalidPrice,
        Stale
    }

    struct Feed {
        AggregatorV3Interface aggregator;
        uint32 maxStaleness;
        uint8 feedDecimals;
        uint8 tokenDecimals;
    }

    mapping(address token => Feed) private _feeds;
    address[] private _tokens;
    mapping(address token => uint256) private _indexPlusOne;

    /// @notice `token` is now priced by `aggregator`, accepting rounds up to `maxStaleness` seconds old.
    event FeedSet(address indexed token, address indexed aggregator, uint32 maxStaleness);

    /// @notice `token` no longer has a price feed.
    event FeedRemoved(address indexed token);

    error ZeroAddress();
    error NotAContract(address account);
    error InvalidStaleness(uint256 maxStaleness);
    error UnsupportedDecimals(uint8 decimals);
    error FeedNotSet(address token);
    error InvalidPrice(address token);
    error StalePrice(address token, uint256 updatedAt, uint256 maxStaleness);

    constructor() Ownable(msg.sender) {}

    /* ------------------------------------------------------------------ *
     * Admin
     * ------------------------------------------------------------------ */

    /**
     * @notice Register or replace the feed for `token`.
     * @param token        ERC-20 address, or `ETH` for native ether.
     * @param aggregator   Chainlink feed quoting `token` in USD.
     * @param maxStaleness Oldest round accepted, in seconds. Set it a little
     *                     above the feed's heartbeat.
     * @dev Reverts unless the feed returns a valid, fresh price right now, so
     *      a dead or mistyped feed can never be registered.
     */
    function setFeed(address token, address aggregator, uint32 maxStaleness) external onlyOwner {
        if (token == address(0) || aggregator == address(0)) revert ZeroAddress();
        if (aggregator.code.length == 0) revert NotAContract(aggregator);
        if (token != ETH && token.code.length == 0) revert NotAContract(token);
        if (maxStaleness == 0 || maxStaleness > MAX_STALENESS_LIMIT) revert InvalidStaleness(maxStaleness);

        uint8 feedDecimals = AggregatorV3Interface(aggregator).decimals();
        if (feedDecimals > PRICE_DECIMALS) revert UnsupportedDecimals(feedDecimals);
        uint8 tokenDecimals = token == ETH ? 18 : IERC20Metadata(token).decimals();
        if (tokenDecimals > 36) revert UnsupportedDecimals(tokenDecimals);

        _feeds[token] = Feed(AggregatorV3Interface(aggregator), maxStaleness, feedDecimals, tokenDecimals);
        if (_indexPlusOne[token] == 0) {
            _tokens.push(token);
            _indexPlusOne[token] = _tokens.length;
        }

        _requireOk(token); // reverts the whole registration on a bad feed
        emit FeedSet(token, aggregator, maxStaleness);
    }

    /// @notice Stop pricing `token`.
    function removeFeed(address token) external onlyOwner {
        uint256 indexPlusOne = _indexPlusOne[token];
        if (indexPlusOne == 0) revert FeedNotSet(token);

        address last = _tokens[_tokens.length - 1];
        _tokens[indexPlusOne - 1] = last;
        _indexPlusOne[last] = indexPlusOne;
        _tokens.pop();
        delete _indexPlusOne[token];
        delete _feeds[token];
        emit FeedRemoved(token);
    }

    /* ------------------------------------------------------------------ *
     * Reads
     * ------------------------------------------------------------------ */

    /**
     * @notice USD price of one whole `token`, 18 decimals.
     * @return price     e.g. 2349.5e18 for ETH at $2,349.50
     * @return updatedAt timestamp of the Chainlink round
     */
    function getPrice(address token) external view returns (uint256 price, uint256 updatedAt) {
        return _requireOk(token);
    }

    /**
     * @notice USD value of `amount` base units of `token`, 18 decimals.
     * @dev Rounds down. Reverts on any failed price check.
     */
    function getValue(address token, uint256 amount) external view returns (uint256 value) {
        (uint256 price, ) = _requireOk(token);
        value = Math.mulDiv(amount, price, 10 ** _feeds[token].tokenDecimals);
    }

    /**
     * @notice Like `getPrice`, but never reverts.
     * @return status    Ok, or why the price must not be used
     * @return price     the normalised answer (also returned when Stale, so a
     *                   dashboard can show the last known value; 0 otherwise)
     * @return updatedAt timestamp of the round (0 when there is none)
     */
    function tryGetPrice(address token) external view returns (Status status, uint256 price, uint256 updatedAt) {
        return _read(token);
    }

    /// @notice The feed configuration for `token`. `aggregator` is zero when unset.
    function feedOf(address token)
        external
        view
        returns (address aggregator, uint32 maxStaleness, uint8 feedDecimals, uint8 tokenDecimals)
    {
        Feed memory feed = _feeds[token];
        return (address(feed.aggregator), feed.maxStaleness, feed.feedDecimals, feed.tokenDecimals);
    }

    /// @notice Every token with a feed, in no particular order.
    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    /// @notice Number of tokens with a feed.
    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    function _requireOk(address token) private view returns (uint256 price, uint256 updatedAt) {
        Status status;
        (status, price, updatedAt) = _read(token);
        if (status == Status.NoFeed) revert FeedNotSet(token);
        if (status == Status.InvalidPrice) revert InvalidPrice(token);
        if (status == Status.Stale) revert StalePrice(token, updatedAt, _feeds[token].maxStaleness);
    }

    function _read(address token) private view returns (Status, uint256, uint256) {
        Feed memory feed = _feeds[token];
        if (address(feed.aggregator) == address(0)) return (Status.NoFeed, 0, 0);

        try feed.aggregator.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (Status.InvalidPrice, 0, updatedAt);
            uint256 price = uint256(answer) * 10 ** (PRICE_DECIMALS - feed.feedDecimals);
            if (block.timestamp - updatedAt > feed.maxStaleness) return (Status.Stale, price, updatedAt);
            return (Status.Ok, price, updatedAt);
        } catch {
            return (Status.InvalidPrice, 0, 0);
        }
    }
}
