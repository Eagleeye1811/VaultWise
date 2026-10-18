import { useCallback, useEffect, useRef, useState } from "react";

import Banner from "../../components/Banner";
import TransactionStatus from "../../components/TransactionStatus";

import DexLiquidityPanel from "./DexLiquidityPanel";
import DexPoolsPanel from "./DexPoolsPanel";
import DexSwapPanel from "./DexSwapPanel";
import DexWalletCard from "./DexWalletCard";

import {
  DEX_FACTORY_ADDRESS,
  DEX_ROUTER_ADDRESS,
  DEX_TOKEN_ADDRESSES,
  TARGET_NETWORK_NAME,
  isDexConfigured,
} from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { useTransaction } from "../../hooks/useTransaction";
import { friendlyError } from "../../utils/errors";
import { formatAmount, parseAmount } from "../../utils/format";
import {
  PAIR_KEYS,
  TOKEN_KEYS,
  getFactoryRead,
  getFactoryWrite,
  getPairRead,
  getPairWrite,
  getRouterRead,
  getRouterWrite,
  getTokenRead,
  getTokenWrite,
  logSources,
  pairKeyOf,
  revertInterfaces,
} from "./dex";
import { decodeRevert, deadlineFrom, explainRevert } from "./dexMath";

/**
 * Experiment 6 — DEX prototype: Factory + Pair + Router.
 *
 * Data rules for this screen:
 *   live        balances, Router allowances, every pool's address, reserves,
 *               LP supply and your LP balance are read from the contracts —
 *               re-read after each confirmed tx, on wallet/network change, and
 *               every 15 s while the tab is visible
 *   calculated  quotes, minimum received, LP estimates — always labelled, and
 *               swaps are re-quoted with Router.getAmountsOut right before
 *               MetaMask opens
 *   receipt     confirmed results come from the transaction's own events
 *
 * Deadlines are measured from the chain's latest block time, not the local
 * clock. Nothing is filled with placeholder numbers: a failed read shows "—".
 */

const POLL_MS = 15_000;
const ZERO = "0x0000000000000000000000000000000000000000";

const emptyTokens = () =>
  Object.fromEntries(
    TOKEN_KEYS.map((key) => [key, { symbol: `DX${key}`, decimals: 18, balance: null, allowance: null }])
  );

const emptyPairs = () =>
  Object.fromEntries(
    PAIR_KEYS.map(({ key, x, y }) => [
      key,
      { key, x, y, address: null, reserveX: null, reserveY: null, supply: null, lpBalance: null, lpAllowance: null },
    ])
  );

const sameAddress = (a, b) => Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();

export default function DexView({ account, networkName, isCorrectNetwork, refreshKey, refresh }) {
  const [tokens, setTokens] = useState(emptyTokens);
  const [pairs, setPairs] = useState(emptyPairs);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [viewError, setViewError] = useState("");
  const [wiringError, setWiringError] = useState("");
  const [lastRead, setLastRead] = useState(null); // { block, timestamp, at }
  const [lastResult, setLastResult] = useState(null);

  const { tx, setTx, pendingAction, execute } = useTransaction();
  const inFlight = useRef(false);

  const connected = Boolean(account);
  const ready = connected && isCorrectNetwork && isDexConfigured && !wiringError;

  /* ---------------------------------------------------------------- *
   * READ — tokens, Router allowances and all three possible pools
   * ---------------------------------------------------------------- */
  const readAll = useCallback(
    async ({ silent = false } = {}) => {
      if (!connected || !isCorrectNetwork || !isDexConfigured) {
        setPairs(emptyPairs());
        setLastRead(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const provider = getProvider();
        const router = getRouterRead(provider);
        const factory = getFactoryRead(provider);

        for (const [label, address] of [
          ["VITE_DEX_FACTORY_ADDRESS", DEX_FACTORY_ADDRESS],
          ["VITE_DEX_ROUTER_ADDRESS", DEX_ROUTER_ADDRESS],
        ]) {
          if ((await provider.getCode(address)) === "0x") {
            setWiringError(
              `There is no contract at ${label} (${address}) on this network. Check frontend/.env and that MetaMask is on ${TARGET_NETWORK_NAME}.`
            );
            return;
          }
        }
        const routerFactory = await router.factory();
        if (!sameAddress(routerFactory, DEX_FACTORY_ADDRESS)) {
          setWiringError(
            `The Router at VITE_DEX_ROUTER_ADDRESS uses Factory ${routerFactory}, but VITE_DEX_FACTORY_ADDRESS is ${DEX_FACTORY_ADDRESS}. Fix frontend/.env and restart the dev server.`
          );
          return;
        }
        setWiringError("");

        const block = await provider.getBlock("latest");
        const at = { blockTag: block.number };

        const tokenEntries = await Promise.all(
          TOKEN_KEYS.map(async (key) => {
            const token = getTokenRead(key, provider);
            const [symbol, decimals, balance, allowance] = await Promise.all([
              token.symbol(),
              token.decimals(),
              token.balanceOf(account, at),
              token.allowance(account, DEX_ROUTER_ADDRESS, at),
            ]);
            return [key, { symbol, decimals: Number(decimals), balance, allowance }];
          })
        );

        const pairEntries = await Promise.all(
          PAIR_KEYS.map(async ({ key, x, y }) => {
            const address = await factory.getPair(DEX_TOKEN_ADDRESSES[x], DEX_TOKEN_ADDRESSES[y], at);
            if (address === ZERO) {
              return [key, { ...emptyPairs()[key], address: null, reserveX: 0n, reserveY: 0n, supply: 0n, lpBalance: 0n, lpAllowance: 0n }];
            }
            const pair = getPairRead(address, provider);
            const [token0, [reserve0, reserve1], supply, lpBalance, lpAllowance] = await Promise.all([
              pair.token0(),
              pair.getReserves(at),
              pair.totalSupply(at),
              pair.balanceOf(account, at),
              pair.allowance(account, DEX_ROUTER_ADDRESS, at),
            ]);
            const xIs0 = sameAddress(token0, DEX_TOKEN_ADDRESSES[x]);
            return [
              key,
              {
                key,
                x,
                y,
                address,
                reserveX: xIs0 ? reserve0 : reserve1,
                reserveY: xIs0 ? reserve1 : reserve0,
                supply,
                lpBalance,
                lpAllowance,
              },
            ];
          })
        );

        setTokens(Object.fromEntries(tokenEntries));
        setPairs(Object.fromEntries(pairEntries));
        setLastRead({ block: block.number, timestamp: block.timestamp, at: Date.now() });
        setReadError("");
      } catch (error) {
        setReadError(
          friendlyError(error, "Could not read the DEX. Check your connection, the Experiment 6 addresses, and that you are on Sepolia.")
        );
        if (!silent) setPairs(emptyPairs());
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [account, connected, isCorrectNetwork]
  );

  useEffect(() => {
    readAll();
  }, [readAll, refreshKey]);

  useEffect(() => {
    if (!connected || !isCorrectNetwork || !isDexConfigured) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) readAll({ silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [readAll, connected, isCorrectNetwork]);

  /** Reserves in (x, y) order, or null when the pool does not exist or is empty. */
  const reservesOf = useCallback(
    (x, y) => {
      const pair = pairs[pairKeyOf(x, y)];
      if (!pair?.address || !pair.reserveX || !pair.reserveY) return null;
      return pair.x === x ? [pair.reserveX, pair.reserveY] : [pair.reserveY, pair.reserveX];
    },
    [pairs]
  );

  /* ---------------------------------------------------------------- *
   * WRITE
   * ---------------------------------------------------------------- */
  const symbols = Object.fromEntries(TOKEN_KEYS.map((key) => [key, tokens[key].symbol]));
  const symbolOfAddress = (address) =>
    symbols[TOKEN_KEYS.find((key) => sameAddress(DEX_TOKEN_ADDRESSES[key], address))] ?? address;
  const fmtToken = (key, raw) => `${formatAmount(raw, tokens[key].decimals, 6)} ${symbols[key]}`;

  const guard = () => {
    if (!connected) return "Connect your wallet first.";
    if (!isDexConfigured)
      return "Experiment 6 addresses are not configured. Set VITE_DEX_FACTORY_ADDRESS, VITE_DEX_ROUTER_ADDRESS and VITE_DEX_TOKEN_A/B/C_ADDRESS in frontend/.env.";
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    if (wiringError) return wiringError;
    if (inFlight.current) return "Another transaction is still pending. Wait for it to finish.";
    return "";
  };

  /** @returns the `execute` result, or null when blocked. */
  const sendTx = async (options) => {
    const problem = guard();
    if (problem) {
      setViewError(problem);
      return null;
    }
    setViewError("");
    inFlight.current = true;
    try {
      const provider = getProvider();
      const result = await execute({ ...options, logSources: logSources(provider, symbols, pairs) });
      if (result.ok) {
        refresh();
      } else if (result.error) {
        const explained = explainRevert(decodeRevert(result.error, revertInterfaces(provider)), {
          symbolOf: symbolOfAddress,
        });
        const message = explained ?? result.message;
        if (explained) setTx((current) => ({ ...current, message }));
        if (message) setViewError(message);
      }
      return result;
    } finally {
      inFlight.current = false;
    }
  };

  /** Deadline `minutes` after the chain's latest block. */
  const chainDeadline = async (minutes) => deadlineFrom((await getProvider().getBlock("latest")).timestamp, minutes);

  const remember = (result, title, lines) => {
    if (!result?.ok) return false;
    setLastResult({ title, lines, hash: result.receipt.hash, block: result.receipt.blockNumber });
    return true;
  };

  const eventsNamed = (result, name) => result.events.filter((e) => e.name === name);
  const argOf = (event, name) => event?.args.find((arg) => arg.name === name)?.value ?? null;

  const mint = async (key, text) => {
    const parsed = parseAmount(text, tokens[key].decimals);
    if (!parsed.ok) return setViewError(parsed.error);
    const result = await sendTx({
      action: `mint-${key}`,
      send: async () => (await getTokenWrite(key, getProvider())).mint(account, parsed.value),
      pending: `Minting ${text} ${symbols[key]}...`,
      success: `Minted ${text} ${symbols[key]} (DexMockERC20.mint is public).`,
    });
    return Boolean(result?.ok);
  };

  const approveToken = async (key, raw, flow = {}) => {
    const result = await sendTx({
      action: `approve-${key}`,
      steps: flow.steps,
      activeStep: flow.activeStep,
      finalStep: false,
      send: async () => (await getTokenWrite(key, getProvider())).approve(DEX_ROUTER_ADDRESS, raw),
      pending: `Approving the Router to spend ${fmtToken(key, raw)}...`,
      success: `Router approved for ${fmtToken(key, raw)}.`,
    });
    return Boolean(result?.ok);
  };

  const approveLp = async (pairKey, raw) => {
    const pair = pairs[pairKey];
    const result = await sendTx({
      action: `approve-lp-${pairKey}`,
      steps: ["Approve LP", "Remove liquidity"],
      activeStep: 0,
      finalStep: false,
      send: async () => (await getPairWrite(pair.address, getProvider())).approve(DEX_ROUTER_ADDRESS, raw),
      pending: `Approving the Router to move ${formatAmount(raw, 18, 6)} LP...`,
      success: "LP approved. Now press Remove.",
    });
    return Boolean(result?.ok);
  };

  const createPair = async (x, y) => {
    const result = await sendTx({
      action: `create-${pairKeyOf(x, y)}`,
      send: async () => (await getFactoryWrite(getProvider())).createPair(DEX_TOKEN_ADDRESSES[x], DEX_TOKEN_ADDRESSES[y]),
      pending: `Factory.createPair(${symbols[x]}, ${symbols[y]})...`,
      success: `Pair ${symbols[x]}/${symbols[y]} created. It is empty until someone adds liquidity.`,
    });
    if (!result?.ok) return false;
    const created = eventsNamed(result, "PairCreated")[0];
    return remember(result, "Pair created", [`PairCreated → ${argOf(created, "pair")}`]);
  };

  const addLiquidity = async ({ x, y, amountX, amountY, minX, minY, deadlineMinutes }) => {
    const deadline = await chainDeadline(deadlineMinutes);
    const result = await sendTx({
      action: "add",
      steps: [`Approve ${symbols[x]}`, `Approve ${symbols[y]}`, "Add liquidity"],
      activeStep: 2,
      send: async () =>
        (await getRouterWrite(getProvider())).addLiquidity(
          DEX_TOKEN_ADDRESSES[x],
          DEX_TOKEN_ADDRESSES[y],
          amountX,
          amountY,
          minX,
          minY,
          account,
          deadline
        ),
      pending: `Adding up to ${fmtToken(x, amountX)} + ${fmtToken(y, amountY)}...`,
      success: "Liquidity added.",
    });
    if (!result?.ok) return false;
    const mintEvent = eventsNamed(result, "Mint")[0];
    return remember(result, "Liquidity added (from the Pair's Mint event)", [
      `amount0 ${argOf(mintEvent, "amount0")} · amount1 ${argOf(mintEvent, "amount1")} (base units, token0/token1 order)`,
      `LP minted to you: ${formatAmount(argOf(mintEvent, "liquidity"), 18, 6)}`,
    ]);
  };

  const removeLiquidity = async ({ x, y, liquidity, minX, minY, deadlineMinutes }) => {
    const deadline = await chainDeadline(deadlineMinutes);
    const result = await sendTx({
      action: "remove",
      steps: ["Approve LP", "Remove liquidity"],
      activeStep: 1,
      send: async () =>
        (await getRouterWrite(getProvider())).removeLiquidity(
          DEX_TOKEN_ADDRESSES[x],
          DEX_TOKEN_ADDRESSES[y],
          liquidity,
          minX,
          minY,
          account,
          deadline
        ),
      pending: `Burning ${formatAmount(liquidity, 18, 6)} LP...`,
      success: "Liquidity removed; both tokens returned.",
    });
    if (!result?.ok) return false;
    const burn = eventsNamed(result, "Burn")[0];
    return remember(result, "Liquidity removed (from the Pair's Burn event)", [
      `amount0 ${argOf(burn, "amount0")} · amount1 ${argOf(burn, "amount1")} (base units, token0/token1 order)`,
      `LP burned: ${formatAmount(argOf(burn, "liquidity"), 18, 6)}`,
    ]);
  };

  /**
   * Swap exact input along `path` (token keys). Re-quotes with the Router on
   * fresh reserves first and refuses if that is already below `minOut`.
   */
  const swap = async ({ path, amountIn, minOut, deadlineMinutes }) => {
    const problem = guard();
    if (problem) return setViewError(problem);
    const provider = getProvider();
    const addresses = path.map((key) => DEX_TOKEN_ADDRESSES[key]);
    const out = path[path.length - 1];

    let fresh;
    try {
      fresh = await getRouterRead(provider).getAmountsOut(amountIn, addresses);
    } catch (error) {
      setViewError(
        explainRevert(decodeRevert(error, revertInterfaces(provider)), { symbolOf: symbolOfAddress }) ??
          friendlyError(error, "Could not quote this route.")
      );
      return false;
    }
    const freshOut = fresh[fresh.length - 1];
    if (freshOut < minOut) {
      setViewError(
        `The Router now quotes ${fmtToken(out, freshOut)}, below your minimum of ${fmtToken(out, minOut)} — the price moved since you looked. Review the quote or lower the minimum.`
      );
      return false;
    }

    const deadline = await chainDeadline(deadlineMinutes);
    const result = await sendTx({
      action: "swap",
      steps: [`Approve ${symbols[path[0]]}`, "Swap"],
      activeStep: 1,
      send: async () =>
        (await getRouterWrite(provider)).swapExactTokensForTokens(amountIn, minOut, addresses, account, deadline),
      pending: `Swapping ${fmtToken(path[0], amountIn)} → ${symbols[out]} via ${path.map((k) => symbols[k]).join(" → ")}...`,
      success: "Swap confirmed.",
    });
    if (!result?.ok) return false;

    const swaps = eventsNamed(result, "Swap");
    return remember(result, `Swap ${path.map((k) => symbols[k]).join(" → ")} (from ${swaps.length} Swap event(s))`, [
      ...swaps.map(
        (e, i) =>
          `hop ${i + 1} (${e.source}): in ${argOf(e, "amount0In")}/${argOf(e, "amount1In")} · out ${argOf(e, "amount0Out")}/${argOf(e, "amount1Out")} (base units, token0/token1)`
      ),
      `quoted before sending: ${fmtToken(out, freshOut)} · minimum: ${fmtToken(out, minOut)}`,
    ]);
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  const busy = pendingAction !== null;
  const shared = { tokens, pairs, symbols, disabled: !ready, busy, pendingAction };

  return (
    <>
      <section className="hero">
        <span className="hero-eyebrow">Experiment 6</span>
        <h1>DEX Prototype</h1>
        <p>
          A decentralised exchange from five contracts. You talk only to the Router; it finds the Pair through the
          Factory, pulls your tokens with <code>transferFrom</code>, and the Pair — the only contract holding
          reserves — runs the AMM with a 0.3 % fee.
        </p>
        <div className="flow-diagram" aria-label="Architecture">
          <span className="flow-node">Your wallet</span>
          <span className="flow-edge">
            approve() <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">Router</span>
          <span className="flow-edge">
            getPair() <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node">Factory</span>
          <span className="flow-edge">
            transferFrom → swap() <span aria-hidden="true">→</span>
          </span>
          <span className="flow-node accent">Pair (x · y = k, 0.3 %)</span>
        </div>
      </section>

      {!isDexConfigured && (
        <Banner tone="warn">
          <strong>Experiment 6 addresses not set.</strong> Run <code>npm run deploy:exp6:sepolia</code> (or deploy in
          Remix), then set <code>VITE_DEX_FACTORY_ADDRESS</code>, <code>VITE_DEX_ROUTER_ADDRESS</code> and{" "}
          <code>VITE_DEX_TOKEN_A/B/C_ADDRESS</code> in <code>frontend/.env</code> and restart <code>npm run dev</code>.
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
        Educational DEX on {TARGET_NETWORK_NAME} — not production-ready, never use real funds. Anyone can mint the demo
        tokens. <span className="kind kind-read">read</span> calls are free; <span className="kind kind-tx">tx</span>{" "}
        actions open MetaMask and cost Sepolia gas.
      </Banner>

      <DexPoolsPanel
        {...shared}
        loading={loading}
        lastRead={lastRead}
        onRefresh={() => readAll()}
        onCreatePair={createPair}
      />

      <div className="cards-grid cards-grid-wide">
        {connected ? (
          <DexWalletCard {...shared} account={account} networkName={networkName} isCorrectNetwork={isCorrectNetwork} onMint={mint} loading={loading} />
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2>Wallet</h2>
            </div>
            <div className="empty">
              <p>Connect MetaMask to use the DEX.</p>
            </div>
          </section>
        )}
        <DexSwapPanel {...shared} reservesOf={reservesOf} onApprove={approveToken} onSwap={swap} />
      </div>

      {lastResult && (
        <section className="panel">
          <div className="panel-head">
            <h2>{lastResult.title}</h2>
            <span className="panel-note">
              <span className="kind kind-hist">receipt</span> block {lastResult.block}
              <button type="button" className="btn btn-outline btn-inline" onClick={() => setLastResult(null)}>
                Dismiss
              </button>
            </span>
          </div>
          <ul className="event-list">
            {lastResult.lines.map((line) => (
              <li key={line} className="event-item">
                <span className="event-args">{line}</span>
              </li>
            ))}
          </ul>
          <p className="card-sub mono">tx {lastResult.hash}</p>
        </section>
      )}

      <DexLiquidityPanel
        {...shared}
        onApprove={approveToken}
        onApproveLp={approveLp}
        onAdd={addLiquidity}
        onRemove={removeLiquidity}
      />

      <TransactionStatus tx={tx} decimals={18} />
    </>
  );
}
