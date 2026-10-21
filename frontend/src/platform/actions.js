import { Contract, MaxUint256 } from "ethers";
import { useCallback, useState } from "react";

import { MOCK_ERC20_ABI } from "../contracts/contractConfig";
import { deadlineFrom } from "../experiments/experiment6/dexMath";
import { getProvider } from "../hooks/useWallet";
import { parseAmount } from "../utils/format";

/**
 * Write-side helpers shared by the platform pages.
 *
 * Same READ / WRITE split as every experiment: reads come from the protocol
 * snapshot, writes build a signer-connected Contract at the moment of sending.
 */

/** A signer-connected contract, created when the user clicks — never earlier. */
export const writeContract = async (address, abi) => new Contract(address, abi, await getProvider().getSigner());

/** A deadline measured from the chain's latest block, not the local clock. */
export const chainDeadline = async (minutes) => deadlineFrom((await getProvider().getBlock("latest")).timestamp, minutes);

/**
 * The approval step for a flow. Skipped when the current allowance already
 * covers `amount`; an unknown allowance (read failed) is never assumed.
 * Approves the exact amount by default — `unlimited` is opt-in.
 */
export function approveStep(token, spender, amount, allowance, { unlimited = false, spenderName = "" } = {}) {
  return {
    label: `Approve ${token.symbol}${spenderName ? ` for ${spenderName}` : ""}`,
    skip: allowance !== null && allowance !== undefined && allowance >= amount,
    send: async () => (await writeContract(token.address, MOCK_ERC20_ABI)).approve(spender, unlimited ? MaxUint256 : amount),
  };
}

/**
 * Validate an amount string against a token and an optional balance.
 * @returns {{ value: bigint|null, error: string }}  error "" when valid, value null when empty
 */
export function checkAmount(input, token, balance, { overLabel = "Insufficient balance" } = {}) {
  if (!input || !token) return { value: null, error: "" };
  const parsed = parseAmount(input, token.decimals);
  if (!parsed.ok) return { value: null, error: parsed.error };
  if (balance !== null && balance !== undefined && parsed.value > balance)
    return { value: parsed.value, error: `${overLabel}` };
  return { value: parsed.value, error: "" };
}

/* ── trade settings, remembered per browser ───────────────────────────── */

const SETTINGS_KEY = "vaultwise.settings.v1";
const DEFAULT_SETTINGS = { slippageBps: 50, deadlineMinutes: 20 };

const readSettings = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export function useTradeSettings() {
  const [settings, setSettings] = useState(readSettings);
  const update = useCallback((patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // not persisted — still applies for this session
      }
      return next;
    });
  }, []);
  return [settings, update];
}
