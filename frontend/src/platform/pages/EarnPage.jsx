import { useEffect, useState } from "react";
import { parseEther } from "ethers";

import {
  ETH_VAULT_ABI,
  ETH_VAULT_ADDRESS,
  STAKING_ADDRESS,
  VAULT_4626_ABI,
  VAULT_4626_ADDRESS,
  YIELD_FARM_ADDRESS,
} from "../../contracts/contractConfig";
import { POOLS } from "../../experiments/experiment5/pools";
import { formatDuration, fundingRunwaySeconds, projectEarned } from "../../experiments/experiment5/rewardMath";
import { approveStep, checkAmount, writeContract } from "../actions";
import { fmtBps, fmtShare, fmtToken, fmtUsd } from "../format";
import { rewardAprBps, usablePrice, usdValue } from "../pricing";
import { usePlatform } from "../usePlatform";
import { ActionButton, AmountField, Badge, Card, EmptyState, Notice, PageHeader, Row, Skeleton, Stat, Tabs, TokenIcon } from "../ui";

/**
 * Earn — the yield side of the platform:
 *   Vaults   ERC-4626 USDC vault (Experiment 3) and the ETH vault (Experiment 1)
 *   Farms    LPT → RWD yield farm and ABC → RWD staking (Experiment 5)
 *
 * With the PriceOracle deployed, deposits show their USD value and the
 * reward pools an APR (reward value per year over the value staked).
 */

/** "≈ $1,234.56" when the oracle prices it, otherwise undefined (no sub-line). */
const usdSub = (data, raw, token) => (data.oracleConfigured && raw !== null && raw !== undefined ? `≈ ${fmtUsd(usdValue(raw, token, data.prices))}` : undefined);

const ETH = { id: "ETH", symbol: "ETH", name: "Sepolia Ether", decimals: 18, hue: "#4a5785" };
const POOL_ADDRESS = { farm: YIELD_FARM_ADDRESS, staking: STAKING_ADDRESS };

function ProductHead({ token, title, tag, sub }) {
  return (
    <div className="vw-product-head">
      <TokenIcon token={token} size={40} />
      <div>
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      <Badge tone="accent">{tag}</Badge>
    </div>
  );
}

/* ── ERC-4626 USDC vault ───────────────────────────────────────────────── */

function UsdcVault({ data }) {
  const { wallet, run } = usePlatform();
  const [tab, setTab] = useState("deposit");
  const [amount, setAmount] = useState("");
  const v = data.vault4626;
  const usdc = data.tokens.USDC;
  const share = data.tokens.vwUSDC;

  if (!v.configured || !usdc || !share)
    return (
      <Card>
        <EmptyState icon="spark" title="USDC vault not deployed">Set VITE_USDC_ADDRESS and VITE_VAULT4626_ADDRESS.</EmptyState>
      </Card>
    );

  const balance = tab === "deposit" ? usdc.balance : v.maxWithdraw;
  const c = checkAmount(amount, usdc, wallet.account ? balance : null, { overLabel: tab === "deposit" ? "Insufficient USDC" : "More than you can withdraw" });
  // OpenZeppelin v5 ERC-4626 with a zero decimals offset: shares = assets·(supply+1)/(totalAssets+1), floored.
  const previewShares = c.value && v.totalAssets !== null ? (c.value * (v.totalSupply + 1n)) / (v.totalAssets + 1n) : null;
  const isMax = tab === "withdraw" && c.value !== null && c.value === v.maxWithdraw;
  const flowKey = `vault-${tab}`;

  const submit = async () => {
    const ok = await run({
      key: flowKey,
      title: tab === "deposit" ? "Deposit into USDC vault" : "Withdraw from USDC vault",
      steps:
        tab === "deposit"
          ? [
              approveStep(usdc, VAULT_4626_ADDRESS, c.value, v.allowance, { spenderName: "vault" }),
              {
                label: `Deposit ${fmtToken(c.value, usdc.decimals)} USDC`,
                send: async () => (await writeContract(VAULT_4626_ADDRESS, VAULT_4626_ABI)).deposit(c.value, wallet.account),
              },
            ]
          : [
              {
                label: `Withdraw ${fmtToken(c.value, usdc.decimals)} USDC`,
                // Withdrawing everything redeems the exact share balance so no dust shares remain.
                send: async () => {
                  const vault = await writeContract(VAULT_4626_ADDRESS, VAULT_4626_ABI);
                  return isMax ? vault.redeem(v.shares, wallet.account, wallet.account) : vault.withdraw(c.value, wallet.account, wallet.account);
                },
              },
            ],
    });
    if (ok) setAmount("");
  };

  return (
    <Card className="vw-product">
      <ProductHead token={usdc} title="Core USDC Vault" tag="ERC-4626" sub="Stablecoin treasury · deposit USDC, hold vwUSDC shares" />
      <div className="vw-mini-stats">
        <Stat label="Total deposits" value={`${fmtToken(v.totalAssets, usdc.decimals)} USDC`} sub={usdSub(data, v.totalAssets, usdc)} />
        <Stat label="Share price" value={v.totalSupply ? `${fmtToken(((v.totalAssets + 1n) * 10n ** BigInt(share.decimals)) / (v.totalSupply + 1n), usdc.decimals)} USDC` : "1 USDC"} />
        <Stat label="Your deposit" value={wallet.account ? `${fmtToken(v.shareValue, usdc.decimals)} USDC` : "—"} sub={wallet.account && v.shares ? `${fmtToken(v.shares, share.decimals)} vwUSDC` : undefined} />
      </div>
      <Tabs value={tab} onChange={(t) => { setTab(t); setAmount(""); }} options={[{ value: "deposit", label: "Deposit" }, { value: "withdraw", label: "Withdraw" }]} />
      <AmountField
        label={tab === "deposit" ? "Deposit" : "Withdraw"}
        value={amount}
        onChange={setAmount}
        token={usdc}
        balance={wallet.account ? balance : undefined}
        balanceLabel={tab === "deposit" ? "Wallet" : "Available"}
        error={c.error}
      />
      {tab === "deposit" && previewShares !== null && (
        <div className="vw-details">
          <Row label="You receive (est.)">{fmtToken(previewShares, share.decimals)} vwUSDC</Row>
          <Row label="Share of vault">{fmtShare(previewShares, v.totalSupply + previewShares)}</Row>
        </div>
      )}
      <ActionButton label={tab === "deposit" ? "Deposit" : "Withdraw"} flowKey={flowKey} onClick={submit} disabledReason={!amount ? "Enter an amount" : c.error} />
      <p className="vw-muted vw-small">Principal-only vault: no strategy is attached, so a share stays worth about 1 USDC. vwUSDC is a transferable ERC-20.</p>
    </Card>
  );
}

/* ── ETH vault ─────────────────────────────────────────────────────────── */

function EthVault({ data }) {
  const { wallet, run } = usePlatform();
  const [tab, setTab] = useState("deposit");
  const [amount, setAmount] = useState("");
  const v = data.ethVault;

  if (!v.configured)
    return (
      <Card>
        <EmptyState icon="spark" title="ETH vault not deployed">Set VITE_CONTRACT_ADDRESS.</EmptyState>
      </Card>
    );

  const balance = tab === "deposit" ? data.ethBalance : v.mine;
  const c = checkAmount(amount, ETH, wallet.account ? balance : null, { overLabel: tab === "deposit" ? "Insufficient ETH" : "More than you deposited" });
  const flowKey = `eth-${tab}`;

  const submit = async () => {
    const ok = await run({
      key: flowKey,
      title: tab === "deposit" ? "Deposit ETH" : "Withdraw ETH",
      steps: [
        {
          label: `${tab === "deposit" ? "Deposit" : "Withdraw"} ${fmtToken(c.value, 18)} ETH`,
          send: async () => {
            const vault = await writeContract(ETH_VAULT_ADDRESS, ETH_VAULT_ABI);
            return tab === "deposit" ? vault.deposit({ value: c.value }) : vault.withdraw(c.value);
          },
        },
      ],
    });
    if (ok) setAmount("");
  };

  const lowGas = tab === "deposit" && c.value && data.ethBalance !== null && data.ethBalance - c.value < parseEther("0.001");

  return (
    <Card className="vw-product">
      <ProductHead token={ETH} title="ETH Savings Vault" tag="Native ETH" sub="Park Sepolia ETH in a non-custodial vault, withdraw any time" />
      <div className="vw-mini-stats">
        <Stat label="Total deposits" value={`${fmtToken(v.total, 18)} ETH`} sub={usdSub(data, v.total, ETH)} />
        <Stat label="Your deposit" value={wallet.account ? `${fmtToken(v.mine, 18)} ETH` : "—"} />
        <Stat label="Your share" value={wallet.account ? fmtShare(v.mine, v.total) : "—"} />
      </div>
      <Tabs value={tab} onChange={(t) => { setTab(t); setAmount(""); }} options={[{ value: "deposit", label: "Deposit" }, { value: "withdraw", label: "Withdraw" }]} />
      <AmountField label={tab === "deposit" ? "Deposit" : "Withdraw"} value={amount} onChange={setAmount} token={ETH} balance={wallet.account ? balance : undefined} balanceLabel={tab === "deposit" ? "Wallet" : "Deposited"} error={c.error} />
      {lowGas && <Notice tone="warn">This leaves less than 0.001 ETH for gas.</Notice>}
      <ActionButton label={tab === "deposit" ? "Deposit ETH" : "Withdraw ETH"} flowKey={flowKey} onClick={submit} disabledReason={!amount ? "Enter an amount" : c.error} />
    </Card>
  );
}

/* ── farm / staking ────────────────────────────────────────────────────── */

/** Re-render every second so pending rewards tick between chain reads. */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function RewardPool({ data, poolKey }) {
  const { wallet, run } = usePlatform();
  const desc = POOLS[poolKey];
  const p = data[poolKey];
  const stakeToken = data.tokens[poolKey === "farm" ? "LPT" : "ABC"];
  const rewardToken = data.tokens[poolKey === "farm" ? "RWD_F" : "RWD_S"];
  const [tab, setTab] = useState("stake");
  const [amount, setAmount] = useState("");
  const ticking = Boolean(wallet.account && p.staked && p.staked > 0n);
  const now = useNow(ticking);

  if (!p.configured || !stakeToken || !rewardToken)
    return (
      <Card>
        <EmptyState icon="spark" title={`${desc.title} not deployed`}>Set the {desc.env.pool} group of addresses.</EmptyState>
      </Card>
    );

  const poolAddress = POOL_ADDRESS[poolKey];
  const earned = ticking
    ? projectEarned({
        earnedAtRead: p.earned,
        staked: p.staked,
        rate: p.rate,
        precision: p.precision,
        readTimestamp: data.blockTimestamp,
        chainNow: data.blockTimestamp + Math.floor((now - data.readAt) / 1000),
      })
    : p.earned;
  const perDay = p.rate && p.precision ? (p.rate * 86_400n * 10n ** 18n) / p.precision : null;
  const runway = fundingRunwaySeconds(p.rewardBalance, p.totalStaked, p.rate, p.precision);
  const underfunded = earned !== null && p.rewardBalance !== null && earned > p.rewardBalance;
  const apr = data.oracleConfigured ? rewardAprBps(perDay, usablePrice(rewardToken, data.prices), usablePrice(stakeToken, data.prices)) : null;

  const balance = tab === "stake" ? stakeToken.balance : p.staked;
  const c = checkAmount(amount, stakeToken, wallet.account ? balance : null, { overLabel: tab === "stake" ? `Insufficient ${stakeToken.symbol}` : "More than you have staked" });
  const errorContext = { stakeSymbol: stakeToken.symbol, rewardSymbol: rewardToken.symbol, noun: desc.noun, withdrawVerb: desc.verb.withdraw };

  const contract = () => writeContract(poolAddress, desc.abi);
  const go = (key, title, steps) => run({ key: `${poolKey}-${key}`, title, steps, errorContext });

  const submit = async () => {
    const ok =
      tab === "stake"
        ? await go("stake", `Stake ${stakeToken.symbol}`, [
            approveStep(stakeToken, poolAddress, c.value, p.allowance, { spenderName: desc.noun }),
            { label: `Stake ${fmtToken(c.value, 18)} ${stakeToken.symbol}`, send: async () => (await contract()).stake(c.value) },
          ])
        : await go("stake", `${desc.verb.withdraw} ${stakeToken.symbol}`, [
            { label: `${desc.verb.withdraw} ${fmtToken(c.value, 18)} ${stakeToken.symbol}`, send: async () => (await contract())[desc.fn.withdraw](c.value) },
          ]);
    if (ok) setAmount("");
  };

  const claim = () =>
    go("claim", `${desc.verb.claim} ${rewardToken.symbol}`, [{ label: desc.verb.claim, send: async () => (await contract())[desc.fn.claim]() }]);
  const exit = () =>
    go("exit", `Exit ${desc.title.toLowerCase()}`, [{ label: "Withdraw all + claim", send: async () => (await contract()).exit() }]);

  return (
    <Card className="vw-product">
      <ProductHead
        token={stakeToken}
        title={poolKey === "farm" ? "LPT Yield Farm" : "ABC Staking"}
        tag={poolKey === "farm" ? "Farm" : "Staking"}
        sub={`Stake ${stakeToken.symbol}, earn ${rewardToken.symbol} every second`}
      />
      <div className="vw-mini-stats">
        <Stat label="Total staked" value={`${fmtToken(p.totalStaked, 18)} ${stakeToken.symbol}`} sub={usdSub(data, p.totalStaked, stakeToken)} />
        <Stat
          label="Emission"
          value={`${fmtToken(perDay, 18)} ${rewardToken.symbol}`}
          sub={`per ${stakeToken.symbol} per day${apr !== null ? ` · ${fmtBps(apr)} APR` : ""}`}
        />
        <Stat label="Reward reserve" value={`${fmtToken(p.rewardBalance, 18)} ${rewardToken.symbol}`} sub={runway !== null ? `≈ ${formatDuration(runway)} at current stake` : "No stakers yet"} />
      </div>

      {wallet.account && (
        <div className="vw-earned">
          <div>
            <span className="vw-stat-label">Your stake</span>
            <strong>
              {fmtToken(p.staked, 18)} {stakeToken.symbol}
            </strong>
          </div>
          <div>
            <span className="vw-stat-label">Pending reward</span>
            <strong className="vw-tick">
              {earned === null ? "—" : Number(earned) === 0 ? "0" : (Number(earned) / 1e18).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 })} {rewardToken.symbol}
            </strong>
          </div>
          <div className="vw-earned-actions">
            <ActionButton
              label={desc.verb.claim}
              variant="secondary"
              block={false}
              flowKey={`${poolKey}-claim`}
              onClick={claim}
              disabledReason={!earned ? "Nothing to claim" : underfunded ? "Pool underfunded" : ""}
            />
            <ActionButton
              label="Exit"
              variant="ghost"
              block={false}
              flowKey={`${poolKey}-exit`}
              onClick={exit}
              disabledReason={!p.staked && !earned ? "Nothing staked" : underfunded ? "Pool underfunded" : ""}
            />
          </div>
        </div>
      )}
      {underfunded && (
        <Notice tone="warn">
          The {desc.noun} holds less {rewardToken.symbol} than you have earned, so payouts are paused until it is refunded. Your stake can still
          be withdrawn with {desc.verb.withdraw}.
        </Notice>
      )}

      <Tabs value={tab} onChange={(t) => { setTab(t); setAmount(""); }} options={[{ value: "stake", label: "Stake" }, { value: "unstake", label: desc.verb.withdraw }]} />
      <AmountField label={tab === "stake" ? "Stake" : desc.verb.withdraw} value={amount} onChange={setAmount} token={stakeToken} balance={wallet.account ? balance : undefined} balanceLabel={tab === "stake" ? "Wallet" : "Staked"} error={c.error} />
      <ActionButton label={tab === "stake" ? "Stake" : desc.verb.withdraw} flowKey={`${poolKey}-stake`} onClick={submit} disabledReason={!amount ? "Enter an amount" : c.error} />
    </Card>
  );
}

export default function EarnPage() {
  const { protocol } = usePlatform();
  const data = protocol.data;

  return (
    <>
      <PageHeader title="Earn" subtitle="Vaults hold your assets; farms and staking pay rewards every second. Withdraw any time." />
      {!data ? (
        <div className="vw-grid-2">
          <Skeleton height="420px" />
          <Skeleton height="420px" />
        </div>
      ) : (
        <>
          <h2 className="vw-section-title">Vaults</h2>
          <div className="vw-grid-2">
            <UsdcVault data={data} />
            <EthVault data={data} />
          </div>
          <h2 className="vw-section-title">Farms &amp; staking</h2>
          <div className="vw-grid-2">
            <RewardPool data={data} poolKey="farm" />
            <RewardPool data={data} poolKey="staking" />
          </div>
        </>
      )}
    </>
  );
}
