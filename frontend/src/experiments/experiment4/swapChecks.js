import { formatUnits } from "ethers";

/**
 * Pre-swap checks for Experiment 4, as pure functions so they can be unit
 * tested without a browser or a wallet.
 *
 * Context: on Sepolia, swapAForB() reverted with
 * InsufficientBalance(TKA, 0, amount). The contract was right — the wallet had
 * deposited every TKA it owned as liquidity, so its balance really was 0 — but
 * nothing on screen made that obvious. These checks compare the facts the
 * contract will check (the signer's balance and allowance, the pool's tokens,
 * the chain) BEFORE MetaMask is opened, and explain any revert in terms of
 * the actual numbers.
 */

const fmt = (raw, decimals = 18) => formatUnits(raw, decimals);
const same = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

/**
 * @param {object} r  facts read from chain at check time
 * @param {bigint} r.chainId            chain the wallet provider is on
 * @param {bigint} r.targetChainId      chain the app is configured for
 * @param {string} r.account            account the UI believes is connected
 * @param {string} r.signerAddress      account MetaMask will actually sign with
 * @param {string} r.poolTokenIn        pool.tokenA()/tokenB() for the input side
 * @param {string} r.configuredTokenIn  VITE_TOKEN_*_ADDRESS for the input side
 * @param {bigint} r.amountIn           exact base units being sold
 * @param {bigint} r.balance            signer's balance of the input token
 * @param {bigint} r.allowance          signer's allowance to the pool
 * @param {bigint} r.reserveIn
 * @param {bigint} r.reserveOut
 * @param {bigint} [r.lpBalance]        signer's LP shares, for the diagnosis
 * @param {string} r.symbolIn
 * @param {number} [r.decimals=18]
 * @returns {string[]} blocking problems; empty means the swap can be sent
 */
export function preflightProblems(r) {
  const problems = [];
  const decimals = r.decimals ?? 18;

  if (r.chainId !== r.targetChainId) {
    problems.push(`MetaMask is on chain ${r.chainId}, not ${r.targetChainId}. Switch networks first.`);
  }
  if (!same(r.account, r.signerAddress)) {
    problems.push(
      `MetaMask would sign with ${r.signerAddress}, but the page shows ${r.account}. Reconnect or reselect the account in MetaMask.`
    );
  }
  if (!same(r.poolTokenIn, r.configuredTokenIn)) {
    problems.push(
      `The pool's ${r.symbolIn} is ${r.poolTokenIn}, but the app is configured with ${r.configuredTokenIn}.`
    );
  }
  if (r.amountIn <= 0n) problems.push("Enter an amount greater than zero.");
  if (r.reserveIn === 0n || r.reserveOut === 0n) {
    problems.push("The pool has no liquidity on one side. Add liquidity before swapping.");
  }
  if (r.balance < r.amountIn) {
    problems.push(insufficientBalanceText(r.symbolIn, r.balance, r.amountIn, r.lpBalance ?? 0n, decimals));
  }
  if (r.allowance < r.amountIn) {
    problems.push(
      `The pool may pull only ${fmt(r.allowance, decimals)} ${r.symbolIn} from you, but this swap needs ${fmt(r.amountIn, decimals)}. Approve ${r.symbolIn} first.`
    );
  }
  return problems;
}

/** The explanation for exactly the Sepolia failure. */
export function insufficientBalanceText(symbol, available, required, lpBalance = 0n, decimals = 18) {
  let text = `Your wallet holds ${fmt(available, decimals)} ${symbol}, but this swap needs ${fmt(required, decimals)} ${symbol}.`;
  if (lpBalance > 0n) {
    text += ` You own ${fmt(lpBalance, decimals)} LP shares — the ${symbol} you deposited is inside the pool, not in your wallet.`;
  }
  text += ` Mint more ${symbol} (token owner only) or remove some liquidity first. An approval does not add tokens.`;
  return text;
}

/**
 * Turn a decoded SimpleAMM revert (`error.revert` from ethers) into a sentence
 * that uses the real numbers it carries.
 *
 * @param {{ name: string, args: any[] } | null | undefined} revert
 * @param {{ symbolOf?: (address: string) => string, lpBalance?: bigint, decimals?: number }} [ctx]
 * @returns {string|null} null when the revert is not one of SimpleAMM's
 */
export function explainRevert(revert, ctx = {}) {
  if (!revert?.name) return null;
  const decimals = ctx.decimals ?? 18;
  const symbolOf = ctx.symbolOf ?? ((address) => address);
  const args = revert.args ?? [];

  switch (revert.name) {
    case "InsufficientBalance":
      return insufficientBalanceText(symbolOf(args[0]), BigInt(args[1]), BigInt(args[2]), ctx.lpBalance ?? 0n, decimals);
    case "InsufficientAllowance":
      return `The pool is approved for ${fmt(BigInt(args[1]), decimals)} ${symbolOf(args[0])} but needs ${fmt(BigInt(args[2]), decimals)}. Approve at least that amount first.`;
    case "InsufficientLPBalance":
      return `You hold ${fmt(BigInt(args[0]), decimals)} LP shares but tried to remove ${fmt(BigInt(args[1]), decimals)}.`;
    case "ZeroAmount":
      return "Amounts must be greater than zero.";
    case "InsufficientLiquidity":
      return "The pool has no liquidity on one side. Add liquidity before swapping.";
    case "InsufficientOutputAmount":
      return "That amount is too small — it would pay out 0 of a token.";
    case "InsufficientLiquidityMinted":
      return "That deposit is too small to mint any LP shares.";
    case "InvalidToken":
      return `${args[0]} is not one of this pool's tokens.`;
    case "ReentrancyGuardReentrantCall":
      return "The pool rejected a re-entrant call.";
    default:
      return null;
  }
}

/**
 * Pull the custom error out of an ethers error, whichever shape it arrived in.
 * ethers' Contract usually decodes it into `error.revert`; some providers only
 * hand back the raw revert data, which is decoded here with the pool's ABI.
 *
 * @param {any} error
 * @param {import("ethers").Interface} iface  SimpleAMM's interface
 * @returns {{ name: string, args: any[] } | null}
 */
export function decodeRevert(error, iface) {
  if (error?.revert?.name) return error.revert;
  const data = [error?.data, error?.info?.error?.data, error?.error?.data].find(
    (value) => typeof value === "string" && value.startsWith("0x") && value.length >= 10
  );
  if (!data) return null;
  try {
    const parsed = iface.parseError(data);
    return parsed ? { name: parsed.name, args: [...parsed.args] } : null;
  } catch {
    return null;
  }
}
