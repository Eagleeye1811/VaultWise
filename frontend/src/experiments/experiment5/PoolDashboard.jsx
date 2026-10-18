import { useCallback, useEffect, useRef, useState } from "react";

import Banner from "../../components/Banner";
import TransactionStatus from "../../components/TransactionStatus";

import PositionStats from "./PositionStats";
import RewardPanel from "./RewardPanel";
import SessionLog from "./SessionLog";
import StakePanel from "./StakePanel";
import StakeWalletCard from "./StakeWalletCard";
import WithdrawPanel from "./WithdrawPanel";

import { TARGET_NETWORK_NAME } from "../../contracts/contractConfig";
import { getProvider } from "../../hooks/useWallet";
import { useTransaction } from "../../hooks/useTransaction";
import { friendlyError } from "../../utils/errors";
import { formatAmount, parseAmount } from "../../utils/format";
import { getPoolRead, getPoolWrite, getTokenRead, getTokenWrite, logSources } from "./pools";
import { decodeRevert, explainRevert, payoutProblem, projectEarned } from "./rewardMath";

/**
 * One Experiment 5 simulation — the yield farm or the staking contract,
 * selected by `pool` (a descriptor from pools.js).
 *
 * Data rules for this screen:
 *   live        every balance, allowance, stake, earned() value and the pool's
 *               RWD funding is read from the deployed contracts; re-read after
 *               each confirmed tx, on wallet/network change, and every 10 s
 *               while the tab is visible
 *   calculated  the ticking "projected now" reward and the funding runway —
 *               always labelled, never used as a transaction amount
 *   receipt     success messages and the session log quote the amounts from
 *               the mined transaction's own events
 *
 * Nothing is filled in with a placeholder number: a failed read shows "—"
 * with a Retry button.
 */

const POLL_MS = 10_000;

const EMPTY_DATA = {
  walletStake: null, // staking-token balance in the wallet
  walletReward: null, // RWD balance in the wallet
  allowance: null, // staking token -> pool
  staked: null, // stakedBalance(user)
  pending: null, // pendingReward(user) — checkpointed only
  earned: null, // earned(user) — pending + accrual since lastUpdate
  lastUpdate: null,
  totalStaked: null,
  rewardBalance: null, // RWD held by the pool
  rate: null,
  precision: null,
};

const sameAddress = (x, y) => Boolean(x) && Boolean(y) && x.toLowerCase() === y.toLowerCase();

/** Value of a named argument in a decoded event from `useTransaction`. */
const argOf = (event, name) => event?.args.find((arg) => arg.name === name)?.value ?? null;

export default function PoolDashboard({ pool, account, networkName, isCorrectNetwork, refreshKey, refresh }) {
  const defaultMeta = {
    stake: { symbol: pool.fallbackSymbol.stake, decimals: 18, owner: null },
    reward: { symbol: pool.fallbackSymbol.reward, decimals: 18, owner: null },
  };
  const [meta, setMeta] = useState(defaultMeta);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [viewError, setViewError] = useState("");
  const [wiringError, setWiringError] = useState("");
  const [lastRead, setLastRead] = useState(null); // { block, timestamp, at }
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [log, setLog] = useState([]);

  const { tx, setTx, pendingAction, execute } = useTransaction();

  // `pendingAction` lags a fast double-click by one render; this ref does not.
  const inFlight = useRef(false);

  const connected = Boolean(account);
  const ready = connected && isCorrectNetwork && pool.configured && !wiringError;

  /* ---------------------------------------------------------------- *
   * READ — one batched snapshot of the pool and the connected wallet
   * ---------------------------------------------------------------- */
  const readAll = useCallback(
    async ({ silent = false } = {}) => {
      if (!connected || !isCorrectNetwork || !pool.configured) {
        setData(EMPTY_DATA);
        setLastRead(null);
        return;
      }

      if (!silent) setLoading(true);
      try {
        const provider = getProvider();
        const contract = getPoolRead(pool, provider);
        const stakeToken = getTokenRead(pool, "stake", provider);
        const rewardToken = getTokenRead(pool, "reward", provider);

        if ((await provider.getCode(pool.address.pool)) === "0x") {
          setWiringError(
            `There is no contract at ${pool.env.pool} (${pool.address.pool}) on this network. Check the address and that MetaMask is on ${TARGET_NETWORK_NAME}.`
          );
          setData(EMPTY_DATA);
          return;
        }

        // Refuse to show numbers for a contract built on other tokens — a stale
        // env file is the likeliest cause of confusing values.
        const [wiredStake, wiredReward] = await Promise.all([contract.stakingToken(), contract.rewardToken()]);
        if (!sameAddress(wiredStake, pool.address.stake) || !sameAddress(wiredReward, pool.address.reward)) {
          setWiringError(
            `${pool.contractName} at ${pool.env.pool} uses staking token ${wiredStake} and reward token ${wiredReward}, but ${pool.env.stake} / ${pool.env.reward} are ${pool.address.stake} / ${pool.address.reward}. Fix frontend/.env and restart the dev server.`
          );
          setData(EMPTY_DATA);
          return;
        }
        setWiringError("");

        const block = await provider.getBlock("latest");
        // Pin every read to the same block so earned() and lastUpdate agree.
        const at = { blockTag: block.number };
        const [
          stakeSymbol,
          stakeDecimals,
          stakeOwner,
          rewardSymbol,
          rewardDecimals,
          rewardOwner,
          walletStake,
          walletReward,
          allowance,
          staked,
          pending,
          earned,
          lastUpdate,
          totalStaked,
          rewardBalance,
          rate,
          precision,
        ] = await Promise.all([
          stakeToken.symbol(),
          stakeToken.decimals(),
          stakeToken.owner(),
          rewardToken.symbol(),
          rewardToken.decimals(),
          rewardToken.owner(),
          stakeToken.balanceOf(account, at),
          rewardToken.balanceOf(account, at),
          stakeToken.allowance(account, pool.address.pool, at),
          contract.stakedBalance(account, at),
          contract.pendingReward(account, at),
          contract.earned(account, at),
          contract.lastUpdate(account, at),
          contract.totalStaked(at),
          rewardToken.balanceOf(pool.address.pool, at),
          contract.rewardRate(),
          contract.REWARD_PRECISION(),
        ]);

        setMeta({
          stake: { symbol: stakeSymbol, decimals: Number(stakeDecimals), owner: stakeOwner },
          reward: { symbol: rewardSymbol, decimals: Number(rewardDecimals), owner: rewardOwner },
        });
        setData({
          walletStake,
          walletReward,
          allowance,
          staked,
          pending,
          earned,
          lastUpdate,
          totalStaked,
          rewardBalance,
          rate,
          precision,
        });
        setLastRead({ block: block.number, timestamp: block.timestamp, at: Date.now() });
        setReadError("");
      } catch (error) {
        setReadError(
          friendlyError(
            error,
            `Could not read ${pool.contractName}. Check your connection, the three Part ${pool.part} addresses, and that you are on ${TARGET_NETWORK_NAME}.`
          )
        );
        if (!silent) setData(EMPTY_DATA);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [account, connected, isCorrectNetwork, pool]
  );

  useEffect(() => {
    readAll();
  }, [readAll, refreshKey]);

  // Background refresh: only while visible and with no tx in flight.
  useEffect(() => {
    if (!connected || !isCorrectNetwork || !pool.configured) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) readAll({ silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [readAll, connected, isCorrectNetwork, pool.configured]);

  // One-second clock for the projected-reward ticker.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const projected = lastRead
    ? projectEarned({
        earnedAtRead: data.earned,
        staked: data.staked,
        rate: data.rate,
        precision: data.precision,
        readTimestamp: lastRead.timestamp,
        chainNow: lastRead.timestamp + Math.floor((nowMs - lastRead.at) / 1000),
      })
    : null;

  /* ---------------------------------------------------------------- *
   * WRITE — every state change goes through here
   * ---------------------------------------------------------------- */
  const explainCtx = {
    stakeSymbol: meta.stake.symbol,
    rewardSymbol: meta.reward.symbol,
    noun: pool.noun,
    withdrawVerb: pool.verb.withdraw,
    decimals: meta.stake.decimals,
  };

  const guard = () => {
    if (!connected) return "Connect your wallet first.";
    if (!pool.configured)
      return `Part ${pool.part} addresses are not configured. Set ${pool.env.stake}, ${pool.env.reward} and ${pool.env.pool} in frontend/.env.`;
    if (!isCorrectNetwork) return `Please switch MetaMask to ${TARGET_NETWORK_NAME}.`;
    if (wiringError) return wiringError;
    if (inFlight.current) return "Another transaction is still pending. Wait for it to finish.";
    return "";
  };

  /** @returns the full `execute` result, or null when blocked by the guard. */
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
      const result = await execute({
        ...options,
        logSources: logSources(pool, provider, { stake: meta.stake.symbol, reward: meta.reward.symbol }),
      });
      if (result.ok) {
        refresh();
      } else if (result.error) {
        // Prefer the contract's own custom error, with its real numbers.
        const explained = explainRevert(decodeRevert(result.error, getPoolRead(pool, provider).interface), explainCtx);
        const message = explained ?? result.message;
        if (explained) setTx((current) => ({ ...current, message }));
        if (message) setViewError(message);
      }
      return result;
    } finally {
      inFlight.current = false;
    }
  };

  const fmtStake = (raw) => `${formatAmount(raw, meta.stake.decimals, 4)} ${meta.stake.symbol}`;
  const fmtReward = (raw) => `${formatAmount(raw, meta.reward.decimals, 6)} ${meta.reward.symbol}`;

  /** Record a confirmed tx in the session log, with amounts from its events. */
  const record = (action, result, amounts) => {
    if (!result?.ok) return false;
    setLog((entries) =>
      [{ action, hash: result.receipt.hash, block: result.receipt.blockNumber, amounts, at: new Date() }, ...entries].slice(0, 12)
    );
    return true;
  };

  const eventOf = (result, name) => result.events.find((e) => e.source === pool.contractName && e.name === name);

  const approve = async (rawAmount) => {
    const result = await sendTx({
      action: "approve",
      steps: [`Approve ${meta.stake.symbol}`, "Stake"],
      activeStep: 0,
      finalStep: false,
      send: async () => (await getTokenWrite(pool, "stake", getProvider())).approve(pool.address.pool, rawAmount),
      pending: `Approving the ${pool.noun} to pull ${fmtStake(rawAmount)}...`,
      success: `Approved ${fmtStake(rawAmount)}. Now press Stake.`,
    });
    return record("approve", result, [`allowance ${fmtStake(rawAmount)}`]);
  };

  const stake = async (rawAmount) => {
    const result = await sendTx({
      action: "stake",
      steps: [`Approve ${meta.stake.symbol}`, "Stake"],
      activeStep: 1,
      send: async () => (await getPoolWrite(pool, getProvider())).stake(rawAmount),
      pending: `Staking ${fmtStake(rawAmount)}...`,
      success: `Staked ${fmtStake(rawAmount)}. Rewards start accruing from this block.`,
    });
    if (!result?.ok) return false;
    return record("stake()", result, [fmtStake(argOf(eventOf(result, pool.event.stake), "amount"))]);
  };

  const claim = async () => {
    const problem = payoutProblem({
      earned: projected ?? data.earned,
      rewardBalance: data.rewardBalance,
      rewardSymbol: meta.reward.symbol,
      noun: pool.noun,
      decimals: meta.reward.decimals,
    });
    if (problem) {
      setViewError(problem);
      return false;
    }
    const result = await sendTx({
      action: "claim",
      send: async () => (await getPoolWrite(pool, getProvider()))[pool.fn.claim](),
      pending: `${pool.verb.claiming} your ${meta.reward.symbol}...`,
      success: `${pool.verb.claim} confirmed.`,
    });
    if (!result?.ok) return false;
    const paid = argOf(eventOf(result, pool.event.reward), "reward");
    setTx((current) => ({ ...current, message: `${pool.verb.claim} paid ${fmtReward(paid)} (from the ${pool.event.reward} event).` }));
    return record(`${pool.fn.claim}()`, result, [fmtReward(paid)]);
  };

  const withdraw = async (rawAmount) => {
    const result = await sendTx({
      action: "withdraw",
      send: async () => (await getPoolWrite(pool, getProvider()))[pool.fn.withdraw](rawAmount),
      pending: `${pool.verb.withdrawing} ${fmtStake(rawAmount)}...`,
      success: `${pool.verb.withdraw} confirmed: ${fmtStake(rawAmount)} returned. Accrued ${meta.reward.symbol} stays pending.`,
    });
    if (!result?.ok) return false;
    return record(`${pool.fn.withdraw}()`, result, [fmtStake(argOf(eventOf(result, pool.event.withdraw), "amount"))]);
  };

  const exit = async () => {
    const problem = payoutProblem({
      earned: projected ?? data.earned,
      rewardBalance: data.rewardBalance,
      rewardSymbol: meta.reward.symbol,
      noun: pool.noun,
      decimals: meta.reward.decimals,
    });
    if (problem) {
      setViewError(`${problem} exit() is all-or-nothing, so use ${pool.verb.withdraw} to recover your stake now.`);
      return false;
    }
    const result = await sendTx({
      action: "exit",
      send: async () => (await getPoolWrite(pool, getProvider())).exit(),
      pending: `Exiting: returning your whole stake and paying every pending ${meta.reward.symbol}...`,
      success: "exit() confirmed.",
    });
    if (!result?.ok) return false;
    const returned = argOf(eventOf(result, pool.event.withdraw), "amount") ?? 0n;
    const paid = argOf(eventOf(result, pool.event.reward), "reward") ?? 0n;
    setTx((current) => ({
      ...current,
      message: `exit() returned ${fmtStake(returned)} and paid ${fmtReward(paid)} (from the receipt's events).`,
    }));
    return record("exit()", result, [fmtStake(returned), fmtReward(paid)]);
  };

  /** Owner-only MockERC20.mint(): test stake tokens to yourself, or RWD funding to the pool. */
  const mint = async (role, amountText) => {
    const decimals = meta[role].decimals;
    const parsed = parseAmount(amountText, decimals);
    if (!parsed.ok) {
      setViewError(parsed.error);
      return false;
    }
    const to = role === "stake" ? account : pool.address.pool;
    const symbol = meta[role].symbol;
    const result = await sendTx({
      action: `mint-${role}`,
      send: async () => (await getTokenWrite(pool, role, getProvider())).mint(to, parsed.value),
      pending:
        role === "stake"
          ? `Minting ${amountText} ${symbol} to your wallet...`
          : `Funding the ${pool.noun} with ${amountText} ${symbol}...`,
      success:
        role === "stake" ? `Minted ${amountText} ${symbol}.` : `The ${pool.noun} now holds ${amountText} more ${symbol}.`,
    });
    return record(role === "stake" ? `mint ${symbol}` : `fund ${pool.contractName}`, result, [`${amountText} ${symbol}`]);
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  const isOwner = {
    stake: sameAddress(account, meta.stake.owner),
    reward: sameAddress(account, meta.reward.owner),
  };
  const busy = pendingAction !== null;
  const panelProps = { pool, meta, data, disabled: !ready, busy, pendingAction };

  return (
    <>
      {!pool.configured && (
        <Banner tone="warn">
          <strong>Part {pool.part} addresses not set.</strong> Deploy <code>MockERC20</code> twice (
          {pool.fallbackSymbol.stake}, {pool.fallbackSymbol.reward}) and <code>{pool.contractName}</code>, then
          set <code>{pool.env.stake}</code>, <code>{pool.env.reward}</code> and <code>{pool.env.pool}</code> in{" "}
          <code>frontend/.env</code> and restart <code>npm run dev</code>. <code>npm run deploy:exp5:sepolia</code>{" "}
          prints all six.
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

      <PositionStats
        pool={pool}
        meta={meta}
        data={data}
        projected={projected}
        loading={loading}
        lastRead={lastRead}
        onRefresh={() => readAll()}
        disabled={!ready}
      />

      <div className="cards-grid cards-grid-wide">
        {connected ? (
          <StakeWalletCard
            {...panelProps}
            account={account}
            networkName={networkName}
            isCorrectNetwork={isCorrectNetwork}
            isOwner={isOwner}
            onMint={mint}
            loading={loading}
          />
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2>Wallet</h2>
            </div>
            <div className="empty">
              <p>Connect MetaMask to use the {pool.noun}.</p>
            </div>
          </section>
        )}

        <RewardPanel {...panelProps} projected={projected} onClaim={claim} onExit={exit} isRewardOwner={isOwner.reward} />
      </div>

      <div className="cards-grid">
        <StakePanel {...panelProps} onApprove={approve} onStake={stake} />
        <WithdrawPanel {...panelProps} onWithdraw={withdraw} />
      </div>

      <TransactionStatus tx={tx} decimals={meta.stake.decimals} />

      <SessionLog pool={pool} entries={log} />
    </>
  );
}
