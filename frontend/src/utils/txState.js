/**
 * Pure state transitions for one transaction's lifecycle, used by
 * `useTransaction`. Kept free of React so the states can be unit tested:
 *
 *   idle -> pending (awaiting signature) -> pending (submitted, has hash)
 *        -> confirmed | failed (reverted on-chain) | failed (rejected / error)
 */

export const IDLE_TX = Object.freeze({
  status: "idle", // idle | pending | confirmed | failed
  hash: null,
  message: "",
  steps: [],
  activeStep: 0,
  events: [],
});

/** Turn step labels + the active index into renderable step states. */
export const buildSteps = (labels, activeIndex, allDone = false) =>
  labels.map((label, index) => ({
    label,
    state: allDone || index < activeIndex ? "done" : index === activeIndex ? "active" : "todo",
  }));

/** MetaMask has been asked to sign; nothing is on-chain yet. */
export const awaitingSignature = (steps, activeStep, carryEvents) => ({
  status: "pending",
  hash: null,
  message: "Waiting for you to confirm in MetaMask...",
  steps: buildSteps(steps, activeStep),
  activeStep,
  events: carryEvents,
});

/** Signed and broadcast; the hash is real and the tx is being mined. */
export const submitted = (current, hash, pendingMessage) => ({
  ...current,
  status: "pending",
  hash,
  message: pendingMessage,
});

/** Mined, but the receipt says it reverted (status 0). */
export const reverted = (current, hash) => ({
  ...current,
  status: "failed",
  hash,
  message: "The transaction was mined but reverted.",
});

/** Mined and successful. */
export const confirmed = ({ hash, success, steps, activeStep, finalStep, events }) => ({
  status: finalStep ? "confirmed" : "pending",
  hash,
  message: success,
  steps: buildSteps(steps, finalStep ? steps.length : activeStep + 1, finalStep),
  activeStep: finalStep ? steps.length : activeStep + 1,
  events,
});

/** Rejected in MetaMask, failed gas estimation, or a network error. */
export const failed = (current, message, hash = null) => ({
  ...current,
  status: "failed",
  hash: hash ?? current.hash ?? null,
  message,
});
