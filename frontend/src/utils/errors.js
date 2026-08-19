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

/** Revert strings coming from VaultWiseVault.sol, mapped to friendlier text. */
const REVERT_MESSAGES = [
  ["Deposit amount must be greater than zero", "Deposit must be greater than 0 ETH."],
  ["Withdraw amount must be greater than zero", "Withdrawal must be greater than 0 ETH."],
  ["Insufficient vault balance", "You cannot withdraw more than you deposited."],
  ["ETH transfer failed", "The vault could not send the ETH back. Please try again."],
  ["Use deposit() to add ETH", "Send ETH using the Deposit card, not a plain transfer."],
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

  // 1. Known error codes (MetaMask numeric codes or ethers string codes).
  const code = error.code ?? error?.info?.error?.code;
  if (code !== undefined && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  // 2. Solidity revert reasons, wherever ethers stashed them.
  const haystack = [
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

  // 3. A few common phrases that don't carry a clean code.
  if (/user (denied|rejected)/i.test(haystack))
    return "You rejected the request in MetaMask.";
  if (/insufficient funds/i.test(haystack))
    return "Not enough ETH in your wallet to cover the amount plus gas.";
  if (/could not decode result|BAD_DATA|missing revert data/i.test(haystack))
    return "Could not read the contract. Check the contract address and that you are on Sepolia.";

  // 4. `error.reason` is usually a clean one-liner already; otherwise fall back.
  return error.reason || fallback;
}
