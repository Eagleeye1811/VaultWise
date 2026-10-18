import { useCallback, useState } from "react";

import { friendlyError } from "../utils/errors";
import {
  IDLE_TX,
  awaitingSignature,
  confirmed,
  failed,
  reverted,
  submitted,
} from "../utils/txState";

export { IDLE_TX };

/**
 * The transaction lifecycle, shared by both experiments.
 *
 * Experiment 1 only ever sent one transaction at a time. Experiment 3 has a
 * genuinely two-step flow — an ERC-20 `approve()` followed by the ERC-4626
 * `deposit()` — and the user needs to see which of the two they are currently
 * confirming in MetaMask. So the state carries an optional list of steps.
 *
 * It also decodes the logs of the confirmed transaction, which is what makes
 * the ERC-20 (`Transfer`, `Approval`) and ERC-4626 (`Deposit`, `Withdraw`)
 * events visible in the UI instead of only in a block explorer.
 */

/**
 * Decode a receipt's logs against the contracts we know about.
 *
 * Matching is on the log's emitting address, never on the event signature: the
 * ERC-4626 shares are themselves an ERC-20, so the vault and the underlying
 * token emit byte-identical `Transfer` signatures and a signature-based match
 * would attribute a share mint to the wrong contract.
 *
 * @param {import("ethers").TransactionReceipt} receipt
 * @param {{ name: string, address: string, iface: import("ethers").Interface, standardOf?: (eventName: string) => string | undefined }[]} sources
 */
function decodeReceiptLogs(receipt, sources) {
  if (!receipt?.logs || sources.length === 0) return [];

  const byAddress = new Map(sources.map((s) => [s.address.toLowerCase(), s]));
  const decoded = [];

  for (const log of receipt.logs) {
    const source = byAddress.get(log.address.toLowerCase());
    if (!source) continue;

    let parsed;
    try {
      parsed = source.iface.parseLog(log);
    } catch {
      continue; // an event this ABI does not describe
    }
    if (!parsed) continue;

    decoded.push({
      source: source.name,
      name: parsed.name,
      // A source may label its own events (Experiment 4 tags the pool's
      // LiquidityAdded/Swap/... as "AMM"). Otherwise: ERC-4626 defines exactly
      // two events, and everything else here is ERC-20.
      standard:
        source.standardOf?.(parsed.name) ??
        (parsed.name === "Deposit" || parsed.name === "Withdraw" ? "ERC-4626" : "ERC-20"),
      args: parsed.fragment.inputs.map((input, i) => ({
        name: input.name,
        type: input.type,
        value: parsed.args[i],
      })),
    });
  }

  return decoded;
}

export function useTransaction() {
  const [tx, setTx] = useState(IDLE_TX);
  const [pendingAction, setPendingAction] = useState(null);

  const reset = useCallback(() => {
    setTx(IDLE_TX);
    setPendingAction(null);
  }, []);

  /**
   * Send one transaction and track it from signature request to receipt.
   *
   * @param {object}   options
   * @param {string}   options.action      key used to disable the right button
   * @param {() => Promise<import("ethers").TransactionResponse>} options.send
   * @param {string}   options.pending     message shown while it is mining
   * @param {string}   options.success     message shown once it is confirmed
   * @param {string[]} [options.steps]     labels for a multi-transaction flow
   * @param {number}   [options.activeStep=0]
   * @param {boolean}  [options.finalStep=true] whether this completes the flow
   * @param {Array}    [options.logSources] contracts whose logs to decode
   * @param {Array}    [options.carryEvents] events from earlier steps to keep
   * @returns {Promise<{ ok: boolean, receipt?: object, events: Array }>}
   */
  const execute = useCallback(
    async ({
      action,
      send,
      pending,
      success,
      steps = [],
      activeStep = 0,
      finalStep = true,
      logSources = [],
      carryEvents = [],
    }) => {
      setPendingAction(action);
      setTx(awaitingSignature(steps, activeStep, carryEvents));

      try {
        const transaction = await send();

        setTx((current) => submitted(current, transaction.hash, pending));

        const receipt = await transaction.wait();

        if (receipt && receipt.status === 0) {
          setTx((current) => reverted(current, transaction.hash));
          return { ok: false, events: carryEvents };
        }

        const events = [...carryEvents, ...decodeReceiptLogs(receipt, logSources)];

        setTx(
          confirmed({ hash: transaction.hash, success, steps, activeStep, finalStep, events })
        );

        return { ok: true, receipt, events };
      } catch (error) {
        const message = friendlyError(error, "The transaction could not be completed.");
        setTx((current) => failed(current, message, error?.transaction?.hash));
        return { ok: false, error, message, events: carryEvents };
      } finally {
        setPendingAction(null);
      }
    },
    []
  );

  return { tx, setTx, pendingAction, reset, execute };
}
