import { useCallback, useEffect, useRef, useState } from "react";

import Banner from "../../components/Banner";
import TransactionStatus from "../../components/TransactionStatus";

import AddLiquidityPanel from "./AddLiquidityPanel";
import PoolActivity from "./PoolActivity";
import PoolStats from "./PoolStats";
import PoolWalletCard from "./PoolWalletCard";
import RemoveLiquidityPanel from "./RemoveLiquidityPanel";
import SwapPanel from "./SwapPanel";
import SwapResultCard from "./SwapResultCard";

import {
  AMM_ADDRESS,
  TARGET_CHAIN_ID,
  TARGET_NETWORK_NAME,
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
  isAmmConfigured,
} from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { useTransaction } from "../../hooks/useTransaction";
import { friendlyError } from "../../utils/errors";
import { formatAmount, parseAmount } from "../../utils/format";
import { minOutForTolerance } from "./ammMath";
import { getAmmRead, getAmmWrite, getTokenRead, getTokenWrite, logSources } from "./contracts";
import { decodeRevert, explainRevert, preflightProblems } from "./swapChecks";

/**
 * Experiment 4 — a no-fee constant-product AMM liquidity pool.
 *
 * Data rules for this screen:
 *   live         every reserve, balance, allowance and LP figure is read from
 *                the deployed contracts; re-read after each confirmed tx, on
 *                wallet/network change, and every 15 s while the tab is visible
 *   calculated   quotes, price impact, LP/removal estimates — always labelled
 *   historical   pool activity comes from the contract's event logs
 *
 * Nothing is ever filled in with a placeholder number: a failed read shows "—"
 * with a Retry button.
 *
 * Swaps go through a pre-swap check before MetaMask opens: chain, signer vs.
 * connected account, pool wiring, the signer's real balance and allowance, the
 * reserves, and an `eth_call` simulation of the exact swap from the signer.
 * That check is what makes a failure like Sepolia's
 * `InsufficientBalance(TKA, 0, amount)` visible — and explained — before any
 * signature is requested.
 */

const POLL_MS = 15_000;

const EMPTY_DATA = {
  reserveA: null,
  reserveB: null,
  supply: null,
  lpBalance: null,
  balanceA: null,
  balanceB: null,
  allowanceA: null,
  allowanceB: null,
};

/** Shown until the chain answers; replaced by real values from the contracts. */
const DEFAULT_META = {
  A: { symbol: "TKA", decimals: 18, owner: null },
  B: { symbol: "TKB", decimals: 18, owner: null },
  lp: { symbol: "vwLP", decimals: 18 },
};

const sameAddress = (x, y) => Boolean(x) && Boolean(y) && x.toLowerCase() === y.toLowerCase();

/** Value of a named argument in a decoded event from `useTransaction`. */
const argOf = (event, name) => event?.args.find((arg) => arg.name === name)?.value ?? null;

export default function AmmView({ account, networkName, isCorrectNetwork, refreshKey, refresh }) {
  const [meta, setMeta] = useState(DEFAULT_META);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [viewError, setViewError] = useState("");
  const [wiringError, setWiringError] = useState("");
  const [lastRead, setLastRead] = useState(null); // { block, at }
  const [preflight, setPreflight] = useState(null);
  const [checking, setChecking] = useState(false);
  const [swapResult, setSwapResult] = useState(null);

  const { tx, pendingAction, execute } = useTransaction();

  // `pendingAction` is React state and lags a fast double-click by one render;
  // this ref closes that gap so a second transaction can never be started.
  const inFlight = useRef(false);

  const connected = Boolean(account);
  const ready = connected && isCorrectNetwork && isAmmConfigured && !wiringError;

  /* ---------------------------------------------------------------- *
   * READ — one batched snapshot of the pool and the connected wallet
   * ---------------------------------------------------------------- */
  const readAll = useCallback(
    async ({ silent = false } = {}) => {
      if (!connected || !isCorrectNetwork || !isAmmConfigured) {
        setData(EMPTY_DATA);
        setLastRead(null);
        return;
      }

      if (!silent) setLoading(true);
      try {
        const provider = getProvider();
        const amm = getAmmRead(provider);
        const tokenA = getTokenRead("A", provider);
        const tokenB = getTokenRead("B", provider);

        if ((await provider.getCode(AMM_ADDRESS)) === "0x") {
          setWiringError(
            `There is no contract at VITE_AMM_ADDRESS (${AMM_ADDRESS}) on this network. Check the address and that MetaMask is on ${TARGET_NETWORK_NAME}.`
          );
          setData(EMPTY_DATA);
          return;
        }

        // Refuse to show numbers for a pool that is not built on the configured
        // tokens — a stale env file is the likeliest cause of confusing values.
        const [poolTokenA, poolTokenB] = await Promise.all([amm.tokenA(), amm.tokenB()]);
        if (!sameAddress(poolTokenA, TOKEN_A_ADDRESS) || !sameAddress(poolTokenB, TOKEN_B_ADDRESS)) {
          setWiringError(
            `The pool at VITE_AMM_ADDRESS trades ${poolTokenA} / ${poolTokenB}, but VITE_TOKEN_A_ADDRESS / VITE_TOKEN_B_ADDRESS are ${TOKEN_A_ADDRESS} / ${TOKEN_B_ADDRESS}. Fix frontend/.env and restart the dev server.`
          );
          setData(EMPTY_DATA);
          return;
        }
        setWiringError("");

        const [
          block,
          symbolA,
          decimalsA,
          ownerA,
          symbolB,
          decimalsB,
          ownerB,
          lpSymbol,
          lpDecimals,
          [reserveA, reserveB],
          supply,
          lpBalance,
          balanceA,
          balanceB,
          allowanceA,
          allowanceB,
        ] = await Promise.all([
          provider.getBlockNumber(),
          tokenA.symbol(),
          tokenA.decimals(),
          tokenA.owner(),
          tokenB.symbol(),
          tokenB.decimals(),
          tokenB.owner(),
          amm.symbol(),
          amm.decimals(),
          amm.getReserves(),
          amm.totalSupply(),
          amm.balanceOf(account),
          tokenA.balanceOf(account),
          tokenB.balanceOf(account),
          tokenA.allowance(account, AMM_ADDRESS),
          tokenB.allowance(account, AMM_ADDRESS),
        ]);

        setMeta({
          A: { symbol: symbolA, decimals: Number(decimalsA), owner: ownerA },
          B: { symbol: symbolB, decimals: Number(decimalsB), owner: ownerB },
          lp: { symbol: lpSymbol, decimals: Number(lpDecimals) },
        });
        setData({
          reserveA,
          reserveB,
          supply,
          lpBalance,
          balanceA,
          balanceB,
          allowanceA,
          allowanceB,
        });
        setLastRead({ block, at: new Date() });
        setReadError("");
      } catch (error) {
        setReadError(
          friendlyError(
            error,
            "Could not read the pool. Check your connection, the three Experiment 4 addresses, and that you are on Sepolia."
          )
        );
        // A silent background refresh keeps the last good snapshot on screen
        // (its block number says how old it is); a foreground read clears it.
        if (!silent) setData(EMPTY_DATA);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [account, connected, isCorrectNetwork]
  );

  // Foreground read on mount, account/network change, and every confirmed tx.
  useEffect(() => {
    readAll();
    setPreflight(null);
  }, [readAll, refreshKey]);

  // Background refresh: only while the tab is visible and no tx is in flight,
  // so an idle tab costs nothing and a pending tx is never raced.
  useEffect(() => {
    if (!connected || !isCorrectNetwork || !isAmmConfigured) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) readAll({ silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [readAll, connected, isCorrectNetwork]);

  /* ---------------------------------------------------------------- *
   * READ — the contract's own swap quote (free, no MetaMask)
   * ---------------------------------------------------------------- */
  const quote = useCallback(
    async (direction, amountIn) => {
      if (!ready) return null;
      const tokenIn = direction === "AtoB" ? TOKEN_A_ADDRESS : TOKEN_B_ADDRESS;
      return getAmmRead(getProvider()).getAmountOut(tokenIn, amountIn);
    },
    [ready]
  );

  /* ---------------------------------------------------------------- *
   * READ — pre-swap check: every fact the contract will check, from the
   * account MetaMask will actually sign with, plus a simulation.
   * ---------------------------------------------------------------- */
  const runPreflight = useCallback(
    async (direction, amountIn) => {
      const [inSide, outSide] = direction === "AtoB" ? ["A", "B"] : ["B", "A"];
      const configuredTokenIn = inSide === "A" ? TOKEN_A_ADDRESS : TOKEN_B_ADDRESS;

      setChecking(true);
      try {
        const provider = getProvider();
        const signer = await provider.getSigner();
        const amm = getAmmRead(provider);
        const tokenIn = getTokenRead(inSide, provider);

        const [network, block, signerAddress] = await Promise.all([
          provider.getNetwork(),
          provider.getBlockNumber(),
          signer.getAddress(),
        ]);
        const [poolTokenIn, balance, allowance, [reserveA, reserveB], lpBalance] = await Promise.all([
          inSide === "A" ? amm.tokenA() : amm.tokenB(),
          tokenIn.balanceOf(signerAddress),
          tokenIn.allowance(signerAddress, AMM_ADDRESS),
          amm.getReserves(),
          amm.balanceOf(signerAddress),
        ]);
        const [reserveIn, reserveOut] = inSide === "A" ? [reserveA, reserveB] : [reserveB, reserveA];

        const facts = {
          chainId: network.chainId,
          targetChainId: TARGET_CHAIN_ID,
          account,
          signerAddress,
          poolTokenIn,
          configuredTokenIn,
          amountIn,
          balance,
          allowance,
          reserveIn,
          reserveOut,
          lpBalance,
          symbolIn: meta[inSide].symbol,
          decimals: meta[inSide].decimals,
        };
        const problems = preflightProblems(facts);

        let quoted = null;
        let simulated = null;
        if (problems.length === 0) {
          quoted = await amm.getAmountOut(configuredTokenIn, amountIn);
          // eth_call from the signer: runs the real swap code against the
          // current state without sending anything.
          const ammAsSigner = await getAmmWrite(provider);
          try {
            simulated =
              direction === "AtoB"
                ? await ammAsSigner.swapAForB.staticCall(amountIn)
                : await ammAsSigner.swapBForA.staticCall(amountIn);
          } catch (error) {
            problems.push(
              explainRevert(decodeRevert(error, ammAsSigner.interface), {
                symbolOf: (address) =>
                  sameAddress(address, TOKEN_A_ADDRESS) ? meta.A.symbol : meta.B.symbol,
                lpBalance,
                decimals: meta[inSide].decimals,
              }) ?? friendlyError(error, "The swap simulation failed.")
            );
          }
        }

        const report = {
          ...facts,
          direction,
          inSide,
          outSide,
          tokenOutAddress: inSide === "A" ? TOKEN_B_ADDRESS : TOKEN_A_ADDRESS,
          block,
          reserveA,
          reserveB,
          quoted,
          simulated,
          problems,
          checkedAt: new Date(),
        };
        setPreflight(report);
        return report;
      } catch (error) {
        const report = {
          direction,
          inSide,
          outSide,
          amountIn,
          problems: [friendlyError(error, "Could not run the pre-swap check.")],
          checkedAt: new Date(),
        };
        setPreflight(report);
        return report;
      } finally {
        setChecking(false);
      }
    },
    [account, meta]
  );

  /* ---------------------------------------------------------------- *
   * WRITE — every state change goes through here
   * ---------------------------------------------------------------- */
  const guard = useCallback(() => {
    if (!connected) return "Connect your wallet first.";
    if (!isAmmConfigured)
      return "Experiment 4 addresses are not configured. Set VITE_TOKEN_A_ADDRESS, VITE_TOKEN_B_ADDRESS and VITE_AMM_ADDRESS in frontend/.env.";
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    if (wiringError) return wiringError;
    if (inFlight.current) return "Another transaction is still pending. Wait for it to finish.";
    return "";
  }, [connected, isCorrectNetwork, wiringError]);

  /** @returns the full `execute` result, or null when blocked by the guard. */
  const sendTx = useCallback(
    async (options) => {
      const problem = guard();
      if (problem) {
        setViewError(problem);
        return null;
      }
      setViewError("");

      inFlight.current = true;
      try {
        const result = await execute({
          ...options,
          logSources: logSources(getProvider(), { A: meta.A.symbol, B: meta.B.symbol }),
        });
        if (result.ok) refresh();
        else if (result.message) setViewError(result.message);
        return result;
      } finally {
        inFlight.current = false;
      }
    },
    [guard, execute, refresh, meta.A.symbol, meta.B.symbol]
  );

  const send = async (options) => Boolean((await sendTx(options))?.ok);

  const symbolOf = (side) => meta[side].symbol;
  const fmtSide = (side, raw) => `${formatAmount(raw, meta[side].decimals, 4)} ${symbolOf(side)}`;

  /** Approve the pool to pull exactly `rawAmount` of one token. */
  const approve = (side, rawAmount, flow) =>
    send({
      action: `approve-${side}`,
      steps: flow.steps,
      activeStep: flow.activeStep,
      finalStep: false,
      send: async () => {
        const token = await getTokenWrite(side, getProvider());
        return token.approve(AMM_ADDRESS, rawAmount);
      },
      pending: `Approving the pool to spend ${fmtSide(side, rawAmount)}...`,
      success: `Pool approved for ${fmtSide(side, rawAmount)}.`,
    });

  const addLiquidity = (rawA, rawB) =>
    send({
      action: "add",
      steps: [`Approve ${symbolOf("A")}`, `Approve ${symbolOf("B")}`, "Add liquidity"],
      activeStep: 2,
      send: async () => (await getAmmWrite(getProvider())).addLiquidity(rawA, rawB),
      pending: `Adding ${fmtSide("A", rawA)} + ${fmtSide("B", rawB)} to the pool...`,
      success: `Liquidity added. Your ${meta.lp.symbol} balance and the reserves have been refreshed.`,
    });

  /**
   * Swap with the pre-swap check and a client-side slippage limit.
   *
   * SimpleAMM's swap functions have no minimum-output parameter, so the limit
   * is enforced against a fresh simulation immediately before signing. It
   * cannot stop the reserves moving between that simulation and the block the
   * swap is mined in — only an on-chain `minAmountOut` could.
   */
  const swap = async (direction, rawIn, shownQuote, toleranceBps) => {
    const problem = guard();
    if (problem) {
      setViewError(problem);
      return false;
    }

    const report = await runPreflight(direction, rawIn);
    if (report.problems.length > 0) return false;

    const minOut = minOutForTolerance(shownQuote, toleranceBps);
    const [inSide, outSide] = [report.inSide, report.outSide];
    if (minOut !== null && report.simulated < minOut) {
      setPreflight({
        ...report,
        problems: [
          `The pool now pays ${fmtSide(outSide, report.simulated)}, below your minimum of ${fmtSide(outSide, minOut)} (${toleranceBps / 100}% tolerance on the ${fmtSide(outSide, shownQuote)} quote). Review the new quote or raise the tolerance.`,
        ],
      });
      return false;
    }

    const result = await sendTx({
      action: "swap",
      steps: [`Approve ${symbolOf(inSide)}`, "Swap"],
      activeStep: 1,
      send: async () => {
        const amm = await getAmmWrite(getProvider());
        return direction === "AtoB" ? amm.swapAForB(rawIn) : amm.swapBForA(rawIn);
      },
      pending: `Swapping ${fmtSide(inSide, rawIn)} for ${symbolOf(outSide)}...`,
      success: `Swap confirmed on-chain.`,
    });
    if (!result?.ok) return false;

    // Everything below comes from the receipt and from fresh reads.
    const swapEvent = result.events.find((e) => e.source === "SimpleAMM" && e.name === "Swap");
    const syncEvent = result.events.find((e) => e.source === "SimpleAMM" && e.name === "Sync");
    let after = null;
    try {
      const provider = getProvider();
      const [[reserveA, reserveB], balanceA, balanceB] = await Promise.all([
        getAmmRead(provider).getReserves(),
        getTokenRead("A", provider).balanceOf(report.signerAddress),
        getTokenRead("B", provider).balanceOf(report.signerAddress),
      ]);
      after = { reserveA, reserveB, balanceA, balanceB };
    } catch (error) {
      console.error("[VaultWise] post-swap read failed", error);
    }

    setSwapResult({
      hash: result.receipt.hash,
      block: result.receipt.blockNumber,
      direction,
      inSide,
      outSide,
      amountIn: argOf(swapEvent, "amountIn"),
      amountOut: argOf(swapEvent, "amountOut"),
      quotedAtSend: report.simulated,
      reservesBefore: { reserveA: report.reserveA, reserveB: report.reserveB },
      reservesSynced: syncEvent
        ? { reserveA: argOf(syncEvent, "reserveA"), reserveB: argOf(syncEvent, "reserveB") }
        : null,
      after,
    });
    setPreflight(null);
    return true;
  };

  const removeLiquidity = (rawLp) =>
    send({
      action: "remove",
      send: async () => (await getAmmWrite(getProvider())).removeLiquidity(rawLp),
      pending: `Burning ${formatAmount(rawLp, meta.lp.decimals, 4)} ${meta.lp.symbol}...`,
      success: `Liquidity removed. Both tokens were returned to your wallet.`,
    });

  const mintTestTokens = (side, amountText) => {
    const parsed = parseAmount(amountText, meta[side].decimals);
    if (!parsed.ok) {
      setViewError(parsed.error);
      return Promise.resolve(false);
    }
    return send({
      action: `faucet-${side}`,
      send: async () => (await getTokenWrite(side, getProvider())).mint(account, parsed.value),
      pending: `Minting ${amountText} ${symbolOf(side)} to your wallet...`,
      success: `Minted ${amountText} ${symbolOf(side)}.`,
    });
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  const isOwner = {
    A: sameAddress(account, meta.A.owner),
    B: sameAddress(account, meta.B.owner),
  };
  const busy = pendingAction !== null;

  const panelProps = { meta, data, disabled: !ready, busy, pendingAction };

  return (
    <>
      <section className="hero">
        <span className="hero-eyebrow">Experiment 4</span>
        <h1>AMM Liquidity Pool</h1>
        <p>
          Deposit {meta.A.symbol} and {meta.B.symbol} into a constant-product pool for{" "}
          {meta.lp.symbol} LP shares, then swap either way against it. Prices follow{" "}
          <code>x · y = k</code>, with no trading fee.
        </p>

        <div className="flow-diagram" aria-label="Architecture">
          <span className="flow-node">Your wallet</span>
          <span className="flow-edge">
            approve()
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">
            {meta.A.symbol} + {meta.B.symbol} (ERC-20)
          </span>
          <span className="flow-edge">
            addLiquidity() / swap
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node accent">SimpleAMM (x · y = k)</span>
          <span className="flow-edge">
            mints
            <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">{meta.lp.symbol} shares</span>
        </div>
      </section>

      {!isAmmConfigured && (
        <Banner tone="warn">
          <strong>Experiment 4 addresses not set.</strong> Deploy <code>MockERC20</code> twice
          (TKA, TKB) and <code>SimpleAMM</code>, then set <code>VITE_TOKEN_A_ADDRESS</code>,{" "}
          <code>VITE_TOKEN_B_ADDRESS</code> and <code>VITE_AMM_ADDRESS</code> in{" "}
          <code>frontend/.env</code> and restart <code>npm run dev</code>.
        </Banner>
      )}

      {wiringError && <Banner tone="error">{wiringError}</Banner>}

      {readError && (
        <Banner tone="error" onDismiss={() => setReadError("")}>
          {readError}{" "}
          <button type="button" className="btn btn-outline btn-inline" onClick={() => readAll()}>
            Retry
          </button>
        </Banner>
      )}

      {viewError && (
        <Banner tone="error" onDismiss={() => setViewError("")}>
          {viewError}
        </Banner>
      )}

      <Banner tone="info">
        Educational, no-fee AMM on {TARGET_NETWORK_NAME}. Not production-ready — never use real
        funds. <span className="kind kind-read">read</span> calls are free;{" "}
        <span className="kind kind-tx">tx</span> actions open MetaMask and cost Sepolia gas.
      </Banner>

      <PoolStats
        data={data}
        meta={meta}
        loading={loading}
        lastRead={lastRead}
        onRefresh={() => readAll()}
        disabled={!ready}
      />

      <div className="cards-grid cards-grid-wide">
        {connected ? (
          <PoolWalletCard
            account={account}
            networkName={networkName}
            isCorrectNetwork={isCorrectNetwork}
            data={data}
            meta={meta}
            isOwner={isOwner}
            onMint={mintTestTokens}
            disabled={!ready}
            busy={busy}
            pendingAction={pendingAction}
            loading={loading}
          />
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2>Wallet</h2>
            </div>
            <div className="empty">
              <p>Connect MetaMask to use the pool.</p>
            </div>
          </section>
        )}

        <SwapPanel
          {...panelProps}
          quote={quote}
          onApprove={approve}
          onSwap={swap}
          onCheck={runPreflight}
          preflight={preflight}
          checking={checking}
        />
      </div>

      {swapResult && (
        <SwapResultCard result={swapResult} meta={meta} onDismiss={() => setSwapResult(null)} />
      )}

      <div className="cards-grid">
        <AddLiquidityPanel {...panelProps} onApprove={approve} onAdd={addLiquidity} />
        <RemoveLiquidityPanel {...panelProps} onRemove={removeLiquidity} />
      </div>

      <TransactionStatus tx={tx} decimals={meta.A.decimals} />

      <PoolActivity meta={meta} ready={ready} refreshKey={refreshKey} account={account} />
    </>
  );
}
