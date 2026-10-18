/**
 * VaultWise — one-transaction-at-a-time sending for live networks.
 *
 * Why this exists
 * ---------------
 * The Sepolia deployer is an EIP-7702 delegated account (a MetaMask smart
 * account). Geth-based nodes allow such an account only ONE in-flight
 * (pending) transaction and reject the next one with
 * "in-flight transaction limit reached for delegated accounts". Experiment 5's
 * first Sepolia run hit this at step 8: `waitForDeployment()` returns as soon
 * as the new contract's code is visible, which can be before the node has
 * dropped the deploy transaction from its pending pool.
 *
 * So every send here:
 *   1. waits until the account has no pending transactions (pending nonce ==
 *      latest nonce) — never two in flight;
 *   2. sends, waits for the receipt and requires status 1;
 *   3. waits for the account to be idle again before returning;
 *   4. retries the in-flight rejection only when the account nonce proves the
 *      rejected transaction was NOT accepted — so a retry can never duplicate.
 */

const IN_FLIGHT = /in-flight transaction limit/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (error) =>
  [error?.shortMessage, error?.message, error?.info?.error?.message, error?.error?.message]
    .filter(Boolean)
    .join(" | ");

/**
 * Wait until `address` has no pending transactions.
 * @returns {Promise<number>} the account's next nonce
 */
export async function waitForIdle(provider, address, { timeoutMs = 300_000, pollMs = 4_000, log = console.log } = {}) {
  const started = Date.now();
  let announced = false;
  for (;;) {
    const [latest, pending] = await Promise.all([
      provider.getTransactionCount(address, "latest"),
      provider.getTransactionCount(address, "pending"),
    ]);
    if (pending <= latest) return latest;
    if (!announced) {
      log(`      waiting: ${pending - latest} transaction(s) from ${address} still pending ...`);
      announced = true;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `${address} still has ${pending - latest} pending transaction(s) after ${timeoutMs / 1000} s. ` +
          "Let them confirm (or cancel them in MetaMask) and run the check script before continuing."
      );
    }
    await sleep(pollMs);
  }
}

/**
 * Send ONE transaction safely and return it with its successful receipt.
 *
 * @param {object} o
 * @param {string} o.label                    printed with every line
 * @param {import("ethers").Provider} o.provider
 * @param {string} o.from                     the sending account
 * @param {() => Promise<import("ethers").TransactionResponse>} o.send
 */
export async function sendConfirmed({ label, provider, from, send, retries = 6, retryDelayMs = 15_000, log = console.log }) {
  for (let attempt = 1; ; attempt += 1) {
    const nonce = await waitForIdle(provider, from, { log });
    let tx;
    try {
      tx = await send();
    } catch (error) {
      if (!IN_FLIGHT.test(messageOf(error)) || attempt >= retries) throw error;
      // Only retry if the node really did not take it: the nonce must not have moved.
      const pendingNow = await provider.getTransactionCount(from, "pending");
      if (pendingNow !== nonce) {
        throw new Error(
          `${label}: the node reported the in-flight limit but the account nonce moved (${nonce} -> ${pendingNow}). ` +
            "Not retrying, to avoid a duplicate. Run the check script to see what was sent."
        );
      }
      log(`      ${label}: node reports the delegated-account in-flight limit; nothing was sent. Retrying in ${retryDelayMs / 1000} s (${attempt}/${retries - 1}) ...`);
      await sleep(retryDelayMs);
      continue;
    }

    log(`      ${label}: sent ${tx.hash} (nonce ${tx.nonce}); waiting for the receipt ...`);
    const receipt = await tx.wait(); // ethers v6 throws on a reverted (status 0) receipt
    if (!receipt || receipt.status !== 1) throw new Error(`${label}: transaction ${tx.hash} failed (status ${receipt?.status}).`);
    log(`      ${label}: confirmed in block ${receipt.blockNumber}`);
    await waitForIdle(provider, from, { log });
    return { tx, receipt };
  }
}

/**
 * Deploy a contract safely. The address is taken from the receipt and must
 * equal the CREATE address for the sender and nonce.
 *
 * @returns {Promise<{ contract: import("ethers").Contract, address: string, txHash: string, receipt: object }>}
 */
export async function deployConfirmed({
  label,
  factory,
  args = [],
  provider,
  from,
  getCreateAddress,
  overrides = {},
  codeRetries = 10,
  codeRetryDelayMs = 6000,
  log = console.log,
}) {
  const { tx, receipt } = await sendConfirmed({
    label,
    provider,
    from,
    log,
    send: async () => (await factory.deploy(...args, overrides)).deploymentTransaction(),
  });
  const expected = getCreateAddress({ from, nonce: tx.nonce });
  if (!receipt.contractAddress || receipt.contractAddress.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: receipt contractAddress ${receipt.contractAddress} != CREATE address ${expected}`);
  }
  // A load-balanced RPC can answer from a node a block or two behind the one
  // that returned the receipt, so give the code time to appear.
  let code = await provider.getCode(receipt.contractAddress);
  for (let i = 0; code === "0x" && i < codeRetries; i += 1) {
    log(`      ${label}: no code at ${receipt.contractAddress} yet (RPC may lag); re-checking ...`);
    await new Promise((resolve) => setTimeout(resolve, codeRetryDelayMs));
    code = await provider.getCode(receipt.contractAddress);
  }
  if (code === "0x") {
    throw new Error(`${label}: no code at ${receipt.contractAddress} after confirmation`);
  }
  return { contract: factory.attach(receipt.contractAddress), address: receipt.contractAddress, txHash: tx.hash, receipt };
}

/**
 * EIP-1559 fees with an explicit priority fee. ethers' default tip is a flat
 * 1 gwei, which on Sepolia (base fee ~0) is nearly the whole price — and with
 * contract deployment now costing ~1 600 gas per byte of code, that adds up.
 *
 * @returns {Promise<{ maxPriorityFeePerGas: bigint, maxFeePerGas: bigint }>}
 */
export async function feeOverrides(provider, priorityFeeGwei) {
  const tip = BigInt(Math.round(Number(priorityFeeGwei) * 1e9));
  if (!(tip > 0n)) throw new Error(`invalid priority fee: ${priorityFeeGwei} gwei`);
  const { baseFeePerGas } = await provider.getBlock("latest");
  return { maxPriorityFeePerGas: tip, maxFeePerGas: 2n * (baseFeePerGas ?? 0n) + tip };
}
