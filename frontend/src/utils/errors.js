/**
 * Turns raw provider / ethers / MetaMask errors into short, human sentences.
 *
 * The raw error is still logged to the console for debugging — only the
 * friendly message is shown in the UI.
 */

/** EIP-1193 + ethers v6 error codes we care about. */
const CODE_MESSAGES = {
  4001: "You rejected the request in MetaMask.",
  ACTION_REJECTED: "You rejected the transaction in MetaMask.",
  INSUFFICIENT_FUNDS: "Not enough ETH in your wallet to cover the amount plus gas.",
  CALL_EXCEPTION: "The contract rejected this call. Check the amount and try again.",
  NETWORK_ERROR: "Network problem. Check your connection and the selected network.",
  UNSUPPORTED_OPERATION: "This operation is not supported by the connected wallet.",
  UNPREDICTABLE_GAS_LIMIT:
    "The transaction would fail. It may exceed your vault balance.",
  "-32002": "MetaMask already has a pending request. Open MetaMask and finish it.",
};

/**
 * Revert strings and custom-error names, mapped to friendlier text.
 *
 * Experiment 1's contract used `require(..., "string")`, so its reverts arrive
 * as revert strings. Experiment 3 inherits OpenZeppelin v5, which uses custom
 * errors instead — they arrive as a name like `ERC20InsufficientAllowance`.
 * Both forms end up somewhere in the error message, so one list covers them.
 */
const REVERT_MESSAGES = [
  // ── Experiment 1 — plain ETH vault ────────────────────────────────
  ["Deposit amount must be greater than zero", "Deposit must be greater than 0 ETH."],
  ["Withdraw amount must be greater than zero", "Withdrawal must be greater than 0 ETH."],
  ["Insufficient vault balance", "You cannot withdraw more than you deposited."],
  ["ETH transfer failed", "The vault could not send the ETH back. Please try again."],
  ["Use deposit() to add ETH", "Send ETH using the Deposit card, not a plain transfer."],

  // ── Experiment 3 — OpenZeppelin ERC-20 custom errors ──────────────
  [
    "ERC20InsufficientAllowance",
    "The vault is not approved to move that many tokens yet. Run Approve first, for at least the amount you are depositing.",
  ],
  ["ERC20InsufficientBalance", "You do not have that many tokens in your wallet."],
  ["ERC20InvalidReceiver", "That recipient address is not valid."],
  ["ERC20InvalidSender", "That sender address is not valid."],
  ["ERC20InvalidApprover", "That approver address is not valid."],
  ["ERC20InvalidSpender", "That spender address is not valid."],

  // ── Experiment 3 — OpenZeppelin ERC-4626 custom errors ────────────
  [
    "ERC4626ExceededMaxDeposit",
    "That deposit is larger than the vault currently accepts.",
  ],
  ["ERC4626ExceededMaxMint", "That is more shares than the vault can mint right now."],
  [
    "ERC4626ExceededMaxWithdraw",
    "You cannot withdraw that much — it is more than your shares are worth.",
  ],
  [
    "ERC4626ExceededMaxRedeem",
    "You cannot redeem that many shares — it is more than you hold.",
  ],

  // ── Experiment 4 — SimpleAMM custom errors ────────────────────────
  // Longer names first: "InsufficientLiquidityMinted" contains
  // "InsufficientLiquidity", and the first match wins.
  [
    "InsufficientLiquidityMinted",
    "That deposit is too small to mint any LP shares. Increase both amounts.",
  ],
  [
    "InsufficientLiquidity",
    "The pool has no liquidity on one side yet. Add liquidity before swapping.",
  ],
  [
    "InsufficientOutputAmount",
    "That amount is too small — it would pay out 0 of a token. Use a larger amount.",
  ],
  [
    "InsufficientLPBalance",
    "You cannot remove more LP shares than you hold.",
  ],
  [
    "InsufficientAllowance",
    "The pool is not approved to move that many tokens yet. Approve the token first, for at least this amount.",
  ],
  ["InsufficientBalance", "You do not have that many tokens in your wallet."],
  ["IdenticalTokens", "Token A and Token B must be different contracts."],
  ["NotAContract", "One of the configured token addresses is not a contract."],
  ["InvalidToken", "That token is not part of this pool."],
  ["ZeroAmount", "Amounts must be greater than zero."],
  ["ZeroAddress", "A token address was the zero address."],
  ["ReentrancyGuardReentrantCall", "The pool rejected a re-entrant call."],

  // ── Experiment 3 — MockUSDC access control ────────────────────────
  [
    "OwnableUnauthorizedAccount",
    "Only the wallet that deployed this token can mint test tokens. Switch to the deployer account, or ask it to mint some for you.",
  ],
];

/**
 * @param {unknown} error   the raw thrown error
 * @param {string}  fallback message to show when nothing else matches
 * @returns {string} a message safe to display to a user
 */
export function friendlyError(error, fallback = "Something went wrong. Please try again.") {
  // Always keep the technical detail available for debugging.
  console.error("[VaultWise]", error);

  if (!error) return fallback;

  const code = error.code ?? error?.info?.error?.code;

  // 1. The user said no — nothing else about the error matters.
  if (code === 4001 || code === "ACTION_REJECTED") return CODE_MESSAGES[code];

  // 2. Solidity revert reasons and custom-error names, wherever ethers stashed
  //    them. Checked before the generic CALL_EXCEPTION text so a specific
  //    reason ("not approved yet") wins over "the contract rejected this call".
  const haystack = [
    error.revert?.name,
    error.reason,
    error.shortMessage,
    error.message,
    error?.info?.error?.message,
    error?.data?.message,
  ]
    .filter(Boolean)
    .join(" | ");

  for (const [needle, friendly] of REVERT_MESSAGES) {
    if (haystack.includes(needle)) return friendly;
  }

  // 3. Known error codes (MetaMask numeric codes or ethers string codes).
  if (code !== undefined && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  // 4. A few common phrases that don't carry a clean code.
  if (/user (denied|rejected)/i.test(haystack))
    return "You rejected the request in MetaMask.";
  if (/insufficient funds/i.test(haystack))
    return "Not enough ETH in your wallet to cover the amount plus gas.";
  if (/could not decode result|BAD_DATA|missing revert data/i.test(haystack))
    return "Could not read the contract. Check the contract address and that you are on Sepolia.";
  if (/transfer amount exceeds allowance|insufficient allowance/i.test(haystack))
    return "The vault is not approved to move that many tokens yet. Run Approve first.";

  // 5. `error.reason` is usually a clean one-liner already; otherwise fall back.
  return error.reason || fallback;
}
