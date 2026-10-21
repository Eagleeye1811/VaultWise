import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { explainError } from "./explainError";
import { PlatformContext } from "./usePlatform";

/**
 * Platform-wide state shared by every page: the wallet, the protocol
 * snapshot, and the transaction manager.
 *
 * The transaction manager replaces the per-experiment status panels with what
 * a production DeFi front end does: a toast that follows each flow from
 * signature to receipt, and an activity log that survives a reload. Hashes are
 * only ever the ones MetaMask returns — nothing is simulated.
 */

const ACTIVITY_KEY = "vaultwise.activity.v1";
const MAX_ACTIVITY = 200;

const loadActivity = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveActivity = (items) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, MAX_ACTIVITY)));
  } catch {
    // storage full or blocked — the log is a convenience, not a record
  }
};

let nextId = 1;

export function PlatformProvider({ wallet, protocol, children }) {
  const [toasts, setToasts] = useState([]);
  const [activity, setActivity] = useState(loadActivity);
  const [busy, setBusy] = useState(null); // key of the flow in progress
  const walletRef = useRef(wallet);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  useEffect(() => saveActivity(activity), [activity]);

  const patchToast = useCallback((id, patch) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const log = useCallback((entry) => setActivity((list) => [entry, ...list]), []);

  const clearActivity = useCallback((account) => {
    setActivity((list) => list.filter((item) => item.account?.toLowerCase() !== account?.toLowerCase()));
  }, []);

  /**
   * Run a flow of one or more transactions in order (typically approve, then
   * the action). Each step's `send` returns an ethers TransactionResponse.
   * Steps with `skip: true` are dropped, so callers can always list the
   * approval and let the current allowance decide.
   *
   * @returns {Promise<boolean>} true when every step confirmed
   */
  const run = useCallback(
    async ({ key, title, steps, errorContext }) => {
      const active = steps.filter((step) => !step.skip);
      if (active.length === 0) return false;
      const id = nextId++;
      const account = walletRef.current.account;
      setBusy(key ?? title);
      setToasts((list) => [
        ...list,
        { id, title, status: "pending", steps: active.map((s) => s.label), stepIndex: 0, message: "Confirm in your wallet…", hash: null },
      ]);

      try {
        for (let i = 0; i < active.length; i += 1) {
          const step = active[i];
          patchToast(id, { stepIndex: i, message: "Confirm in your wallet…", hash: null });
          const tx = await step.send();
          patchToast(id, { message: `${step.label}: waiting for confirmation…`, hash: tx.hash });
          const receipt = await tx.wait();
          if (!receipt || receipt.status === 0) throw Object.assign(new Error("reverted"), { reverted: true, hash: tx.hash });
          log({ id: `${tx.hash}`, account, title: step.label, flow: title, hash: tx.hash, status: "confirmed", time: Date.now() });
          walletRef.current.refresh();
        }
        patchToast(id, { status: "confirmed", stepIndex: active.length, message: "Confirmed on Sepolia." });
        setTimeout(() => dismissToast(id), 7000);
        return true;
      } catch (error) {
        const message = error?.reverted ? "The transaction was mined but reverted." : explainError(error, errorContext);
        patchToast(id, { status: "failed", message });
        if (error?.reverted || error?.transaction?.hash) {
          const hash = error.hash ?? error.transaction.hash;
          log({ id: hash, account, title, flow: title, hash, status: "failed", time: Date.now() });
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [dismissToast, log, patchToast]
  );

  const value = useMemo(
    () => ({ wallet, protocol, run, busy, toasts, dismissToast, activity, clearActivity }),
    [wallet, protocol, run, busy, toasts, dismissToast, activity, clearActivity]
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}
