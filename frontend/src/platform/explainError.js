import { Interface } from "ethers";

import {
  DEX_FACTORY_ABI,
  DEX_PAIR_ABI,
  DEX_ROUTER_ABI,
  SIMPLE_AMM_ABI,
  SIMPLE_STAKING_ABI,
  SIMPLE_YIELD_FARM_ABI,
  VAULT_4626_ABI,
} from "../contracts/contractConfig";
import { decodeRevert as decodeDexRevert, explainRevert as explainDexRevert } from "../experiments/experiment6/dexMath";
import { explainRevert as explainRewardRevert } from "../experiments/experiment5/rewardMath";
import { friendlyError } from "../utils/errors";

/**
 * One error explainer for the whole platform.
 *
 * The experiment views each knew which contract they were talking to; the
 * platform's transaction manager does not, so it decodes a revert against
 * every custom-error ABI we ship and asks each experiment's explainer in
 * turn, falling back to the generic `friendlyError`.
 */

const INTERFACES = [
  DEX_ROUTER_ABI,
  DEX_PAIR_ABI,
  DEX_FACTORY_ABI,
  SIMPLE_YIELD_FARM_ABI,
  SIMPLE_STAKING_ABI,
  SIMPLE_AMM_ABI,
  VAULT_4626_ABI,
].map((abi) => new Interface(abi));

/**
 * @param {unknown} error
 * @param {{ stakeSymbol?: string, rewardSymbol?: string, noun?: string }} [ctx]
 * @returns {string}
 */
export function explainError(error, ctx = {}) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return friendlyError(error);

  const revert = decodeDexRevert(error, INTERFACES);
  // SimpleAMM's InsufficientBalance/Allowance lead with a token address, the
  // reward contracts' with amounts — only the latter fit the reward wording.
  const addressFirst = typeof revert?.args?.[0] === "string";
  const explained = explainDexRevert(revert) ?? (addressFirst ? null : explainRewardRevert(revert, ctx));
  if (explained) {
    console.error("[VaultWise]", error);
    return explained;
  }
  return friendlyError(error, "The transaction could not be completed.");
}
