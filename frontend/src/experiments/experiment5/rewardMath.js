import { formatUnits } from "ethers";

/**
 * Reward arithmetic and revert explanations for Experiment 5, as pure
 * functions so they can be tested against the real contracts without a
 * browser or a wallet (see test/experiment5.frontend.test.js).
 *
 * Every function mirrors the contracts' integer maths exactly:
 *
 *     accrued = staked * rewardRate * seconds / precision      (floor)
 *
 * with rewardRate = 1e15 and precision = 1e18, both read from the contract at
 * runtime rather than assumed.
 */

const fmt = (raw, decimals = 18) => formatUnits(raw, decimals);

/** Reward accrued by `staked` base units over `seconds`, exactly as the contract computes it. */
export function accrued(staked, rate, precision, seconds) {
  if (staked === null || staked === undefined || rate === null || precision === null || precision === 0n) return null;
  const s = BigInt(Math.max(0, Math.floor(seconds)));
  return (staked * rate * s) / precision;
}

/** RWD base units earned per second by `staked` base units (floored). */
export const rewardPerSecond = (staked, rate, precision) => accrued(staked, rate, precision, 1);

/**
 * Project `earned()` forward from the last chain read to "now", for a live
 * ticker. `chainNow` is in chain seconds — the read's block timestamp plus the
 * wall-clock time since — so a skewed local clock cannot inflate it.
 *
 * The projection is a display aid only; the transaction pays whatever the
 * contract computes at the block it is mined in.
 *
 * @returns {bigint|null}
 */
export function projectEarned({ earnedAtRead, staked, rate, precision, readTimestamp, chainNow }) {
  if (earnedAtRead === null || earnedAtRead === undefined || readTimestamp === null) return null;
  const extra = accrued(staked, rate, precision, chainNow - readTimestamp);
  return extra === null ? earnedAtRead : earnedAtRead + extra;
}

/**
 * How long the pool's RWD lasts at the current total stake, ignoring rewards
 * already accrued but unpaid. Labelled as an estimate in the UI.
 *
 * @returns {number|null} seconds, or null when nothing is staked
 */
export function fundingRunwaySeconds(rewardBalance, totalStaked, rate, precision) {
  const perSecond = rewardPerSecond(totalStaked, rate, precision);
  if (rewardBalance === null || perSecond === null || perSecond === 0n) return null;
  return Number(rewardBalance / perSecond);
}

/** "2 h 46 min", "59 s" — for the runway estimate. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Blocking problems for a reward payout (harvest / claimReward / exit),
 * checked against live values before MetaMask is opened.
 *
 * @returns {string|null}
 */
export function payoutProblem({ earned, rewardBalance, rewardSymbol = "RWD", noun = "contract", decimals = 18 }) {
  if (earned === null || rewardBalance === null) return null;
  if (earned > rewardBalance) {
    return `The ${noun} holds only ${fmt(rewardBalance, decimals)} ${rewardSymbol} but owes you ${fmt(earned, decimals)} ${rewardSymbol}. It pays nothing until it is funded — the RWD owner must mint RWD to the ${noun}'s address. Your reward stays pending, and your stake can still be withdrawn on its own.`;
  }
  return null;
}

/**
 * Pull the custom error out of an ethers error, whichever shape it arrived in:
 * ethers' Contract usually decodes it into `error.revert`; some providers only
 * hand back raw revert data, decoded here with the given ABI interface.
 *
 * @returns {{ name: string, args: any[] } | null}
 */
export function decodeRevert(error, iface) {
  if (error?.revert?.name) return error.revert;
  const data = [error?.data, error?.info?.error?.data, error?.error?.data].find(
    (value) => typeof value === "string" && value.startsWith("0x") && value.length >= 10
  );
  if (!data || !iface) return null;
  try {
    const parsed = iface.parseError(data);
    return parsed ? { name: parsed.name, args: [...parsed.args] } : null;
  } catch {
    return null;
  }
}

/**
 * Turn a decoded SimpleYieldFarm / SimpleStaking revert into a sentence that
 * uses the real numbers it carries.
 *
 * @param {{ name: string, args: any[] } | null} revert
 * @param {{ stakeSymbol?: string, rewardSymbol?: string, noun?: string, withdrawVerb?: string, decimals?: number }} [ctx]
 * @returns {string|null} null when the revert is not one of these contracts'
 */
export function explainRevert(revert, ctx = {}) {
  if (!revert?.name) return null;
  const stake = ctx.stakeSymbol ?? "tokens";
  const reward = ctx.rewardSymbol ?? "RWD";
  const noun = ctx.noun ?? "contract";
  const withdrawVerb = (ctx.withdrawVerb ?? "withdraw").toLowerCase();
  const decimals = ctx.decimals ?? 18;
  const n = (i) => fmt(BigInt(revert.args?.[i] ?? 0), decimals);

  switch (revert.name) {
    case "ZeroAmount":
      return "Enter an amount greater than zero.";
    case "InsufficientBalance":
      return `Your wallet holds ${n(0)} ${stake}, but this stake needs ${n(1)} ${stake}.`;
    case "InsufficientAllowance":
      return `The ${noun} is approved to pull ${n(0)} ${stake}, but this stake needs ${n(1)}. Approve at least that amount first.`;
    case "InsufficientStakedBalance":
      return `You have ${n(0)} ${stake} staked, so you cannot ${withdrawVerb} ${n(1)}.`;
    case "InsufficientRewardFunding":
      return `The ${noun} holds only ${n(0)} ${reward} but must pay ${n(1)} ${reward}. The RWD owner must fund it first; your reward stays pending and your stake can still be withdrawn on its own.`;
    case "NoRewardToHarvest":
    case "NoRewardToClaim":
      return "No reward has accrued yet. Stake first, then wait a few seconds.";
    case "NothingToExit":
      return "You have no stake and no pending reward, so there is nothing to exit.";
    case "TransferAmountMismatch":
      return `The ${noun} received ${n(1)} ${stake} instead of ${n(0)} — the token charges a transfer fee, which is not supported.`;
    case "ReentrancyGuardReentrantCall":
      return `The ${noun} rejected a re-entrant call.`;
    case "SafeERC20FailedOperation":
      return "A token transfer reported failure, so the whole transaction was reverted.";
    case "OwnableUnauthorizedAccount":
      return "Only the wallet that deployed this token can mint it. Switch to the deployer account.";
    default:
      return null;
  }
}
