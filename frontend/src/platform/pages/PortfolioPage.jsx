import { useState } from "react";

import { EXPLORER_ADDRESS_BASE_URL } from "../../contracts/contractConfig";
import { shortAddress } from "../../utils/format";
import { fmtToken } from "../format";
import { usePlatform } from "../usePlatform";
import { derivePositions } from "../positions";
import { TOKENS } from "../registry";
import { ActionButton, Amount, Badge, Card, EmptyState, Icon, PageHeader, Skeleton, Stat, TokenIcon } from "../ui";

/**
 * Portfolio — everything the connected account holds: wallet balances of
 * every platform token, and every open position with its underlying value.
 */

const ETH = { id: "ETH", symbol: "ETH", name: "Sepolia Ether", decimals: 18, hue: "#4a5785", product: "Gas" };

export default function PortfolioPage() {
  const { protocol, wallet } = usePlatform();
  const [hideZero, setHideZero] = useState(true);
  const data = protocol.data;

  if (!wallet.account)
    return (
      <>
        <PageHeader title="Portfolio" subtitle="Your balances and positions across every VaultWise product." />
        <Card>
          <EmptyState icon="wallet" title="Connect a wallet to see your portfolio" action={<div className="vw-narrow"><ActionButton label="" /></div>}>
            VaultWise only reads public on-chain data for your address — nothing is stored.
          </EmptyState>
        </Card>
      </>
    );

  const positions = derivePositions(data);
  const wallets = data ? [{ ...ETH, balance: data.ethBalance }, ...TOKENS.map((t) => data.tokens[t.id])] : [];
  const shown = hideZero ? wallets.filter((t) => t.balance && t.balance > 0n) : wallets;
  const pending = positions.filter((p) => p.pending?.raw > 0n);

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={
          <>
            <a className="vw-link" href={`${EXPLORER_ADDRESS_BASE_URL}${wallet.account}`} target="_blank" rel="noreferrer">
              {shortAddress(wallet.account, 8, 6)} <Icon name="external" size={12} />
            </a>
          </>
        }
      />
      <div className="vw-stats-row">
        <Stat label="ETH balance" value={data ? `${fmtToken(data.ethBalance, 18)} ETH` : null} loading={!data} sub="For gas and the ETH vault" />
        <Stat label="Tokens held" value={data ? wallets.filter((t) => t.balance > 0n).length : null} loading={!data} sub={`of ${wallets.length} platform assets`} />
        <Stat label="Open positions" value={data ? positions.length : null} loading={!data} sub="Vaults, pools, farms" />
        <Stat
          label="Pending rewards"
          value={data ? `${fmtToken(pending.reduce((sum, p) => sum + p.pending.raw, 0n), 18)} RWD` : null}
          loading={!data}
          sub="Claim on the Earn page"
        />
      </div>

      <Card title="Positions" subtitle="Valued in underlying tokens — USD pricing arrives with the oracle (Experiment 7)" padded={false}>
        {!data ? (
          <div className="vw-pad">
            <Skeleton height="56px" />
          </div>
        ) : positions.length === 0 ? (
          <EmptyState icon="spark" title="No open positions" action={<a className="vw-btn vw-btn-secondary" href="#/earn">Find yield</a>}>
            Deposit into a vault, add liquidity or stake to see positions here.
          </EmptyState>
        ) : (
          <div className="vw-table" role="table">
            <div className="vw-tr vw-th vw-tr-4" role="row">
              <span role="columnheader">Position</span>
              <span role="columnheader">Holdings</span>
              <span role="columnheader">Pending reward</span>
              <span role="columnheader" />
            </div>
            {positions.map((p) => (
              <a key={p.id} className="vw-tr vw-tr-4" role="row" href={`#/${p.route}`}>
                <span className="vw-td-main" role="cell">
                  <TokenIcon token={p.holdings[0].token} size={32} />
                  <span>
                    <strong>{p.product}</strong>
                    <small>
                      <Badge>{p.kind}</Badge>
                    </small>
                  </span>
                </span>
                <span role="cell" data-label="Holdings">
                  {p.holdings.map((h) => (
                    <span key={h.token.symbol} className="vw-block">
                      <Amount raw={h.raw} token={h.token} />
                    </span>
                  ))}
                </span>
                <span role="cell" data-label="Pending reward">
                  {p.pending ? <Amount raw={p.pending.raw} token={p.pending.token} /> : <span className="vw-muted">—</span>}
                </span>
                <span role="cell" className="vw-td-go">
                  <Icon name="chevron" />
                </span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Wallet"
        subtitle="Platform tokens in your wallet"
        padded={false}
        actions={
          <label className="vw-toggle">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide zero balances
          </label>
        }
      >
        {!data ? (
          <div className="vw-pad">
            <Skeleton height="56px" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="faucet" title="No tokens yet" action={<a className="vw-btn vw-btn-secondary" href="#/faucet">Open faucet</a>}>
            Mint free test tokens to get started.
          </EmptyState>
        ) : (
          <div className="vw-table" role="table">
            <div className="vw-tr vw-th vw-tr-3" role="row">
              <span role="columnheader">Asset</span>
              <span role="columnheader">Used in</span>
              <span role="columnheader">Balance</span>
            </div>
            {shown.map((t) => (
              <div key={t.id} className="vw-tr vw-tr-3" role="row">
                <span className="vw-td-main" role="cell">
                  <TokenIcon token={t} size={32} />
                  <span>
                    <strong>{t.symbol}</strong>
                    <small>{t.name}</small>
                  </span>
                </span>
                <span role="cell" data-label="Used in">
                  {t.product}
                </span>
                <span role="cell" data-label="Balance" className="vw-num">
                  <Amount raw={t.balance} token={t} suffix={false} />
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
