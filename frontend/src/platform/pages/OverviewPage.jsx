import { fmtToken, fmtUsd } from "../format";
import { usePlatform } from "../usePlatform";
import { derivePositions } from "../positions";
import { positionUsd, protocolTvl, sumUsd } from "../pricing";
import { DEX_TOKEN_ID, PRODUCTS } from "../registry";
import { Badge, Card, Icon, PageHeader, Skeleton, Stat, TokenIcon } from "../ui";

/**
 * Overview — the landing page: what the protocol holds right now, every
 * market with its live liquidity, and the visitor's own positions at a glance.
 */

const ETH = { id: "ETH", symbol: "ETH", decimals: 18, hue: "#4a5785" };

/** Liquidity + terms for one product row, from the snapshot. */
function describe(product, data) {
  const t = data.tokens;
  const amt = (raw, token) => (token ? `${fmtToken(raw, token.decimals)} ${token.symbol}` : "—");
  const perDay = (p) => (p.rate && p.precision ? (p.rate * 86_400n * 10n ** 18n) / p.precision : null);

  switch (product.id) {
    case "dex": {
      const pairs = Object.values(data.dex.pairs).filter((p) => p.address && p.reserveX > 0n);
      return {
        token: t.DXA,
        liquidity: pairs.length ? `${pairs.length} active pair${pairs.length > 1 ? "s" : ""}` : "No liquidity yet",
        detail: pairs.map((p) => `${t[DEX_TOKEN_ID[p.x]].symbol}/${t[DEX_TOKEN_ID[p.y]].symbol}`).join(" · "),
        terms: "0.3% swap fee to LPs",
      };
    }
    case "amm":
      return { token: t.TKA, liquidity: amt(data.amm.reserveA, t.TKA), detail: amt(data.amm.reserveB, t.TKB), terms: "No fee · constant product" };
    case "vault4626":
      return { token: t.USDC, liquidity: amt(data.vault4626.totalAssets, t.USDC), detail: "ERC-4626 shares (vwUSDC)", terms: "Principal only" };
    case "ethVault":
      return { token: ETH, liquidity: amt(data.ethVault.total, ETH), detail: "Withdraw any time", terms: "Principal only" };
    case "farm":
      return { token: t.LPT, liquidity: amt(data.farm.totalStaked, t.LPT), detail: `Reserve ${amt(data.farm.rewardBalance, t.RWD_F)}`, terms: `${fmtToken(perDay(data.farm), 18)} RWD / LPT / day` };
    case "staking":
      return { token: t.ABC, liquidity: amt(data.staking.totalStaked, t.ABC), detail: `Reserve ${amt(data.staking.rewardBalance, t.RWD_S)}`, terms: `${fmtToken(perDay(data.staking), 18)} RWD / ABC / day` };
    default:
      return { liquidity: "—" };
  }
}

export default function OverviewPage() {
  const { protocol, wallet } = usePlatform();
  const data = protocol.data;
  const positions = derivePositions(data);
  const live = PRODUCTS.filter((p) => p.configured).length;
  const activePairs = data ? Object.values(data.dex.pairs).filter((p) => p.address && p.reserveX > 0n).length + (data.amm.reserveA > 0n ? 1 : 0) : null;
  const pendingRewards = positions.filter((p) => p.pending?.raw > 0n);
  const tvl = data?.oracleConfigured ? protocolTvl(data, DEX_TOKEN_ID) : null;
  const myUsd = data?.oracleConfigured && positions.length ? sumUsd(positions.map((p) => positionUsd(p, data.prices))) : null;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Protocol state on Sepolia, read directly from the contracts."
        actions={
          <>
            <a className="vw-btn vw-btn-secondary vw-btn-sm" href="#/earn">
              Earn
            </a>
            <a className="vw-btn vw-btn-primary vw-btn-sm" href="#/swap">
              Swap
            </a>
          </>
        }
      />
      <div className="vw-stats-row">
        {data?.oracleConfigured && (
          <Stat
            label="Total value locked"
            value={fmtUsd(tvl.total)}
            sub={tvl.complete ? "All products, at oracle prices" : "Excludes products without a live price"}
          />
        )}
        <Stat label="Live products" value={`${live} / ${PRODUCTS.length}`} sub="Deployed and readable" />
        <Stat label="Active pools" value={activePairs} loading={!data} sub="Pools with liquidity" />
        <Stat label="USDC vault" value={data ? `${fmtToken(data.vault4626.totalAssets, data.tokens.USDC?.decimals ?? 6)} USDC` : null} loading={!data} sub="Total deposits" />
        <Stat label="ETH vault" value={data ? `${fmtToken(data.ethVault.total, 18)} ETH` : null} loading={!data} sub="Total deposits" />
      </div>

      {wallet.account && (
        <Card
          title="Your account"
          subtitle={
            positions.length
              ? `${positions.length} open position${positions.length > 1 ? "s" : ""}${myUsd !== null ? ` · ${fmtUsd(myUsd)}` : ""}`
              : "No open positions yet"
          }
          actions={
            <a className="vw-link" href="#/portfolio">
              Full portfolio <Icon name="chevron" size={12} />
            </a>
          }
        >
          {!data ? (
            <Skeleton height="64px" />
          ) : positions.length === 0 ? (
            <div className="vw-onboard">
              {[
                ["1", "Get test tokens", "Mint DXA, DXB and DXC from the faucet.", "#/faucet"],
                ["2", "Make a swap", "Trade through the best route on the DEX.", "#/swap"],
                ["3", "Earn", "Supply liquidity or deposit into a vault.", "#/earn"],
              ].map(([n, title, body, href]) => (
                <a key={n} className="vw-onboard-step" href={href}>
                  <span>{n}</span>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </a>
              ))}
            </div>
          ) : (
            <div className="vw-chip-row">
              {positions.map((p) => (
                <a key={p.id} className="vw-pos-chip" href={`#/${p.route}`}>
                  <TokenIcon token={p.holdings[0].token} size={24} />
                  <span>
                    <strong>{p.product}</strong>
                    <small>{p.holdings.map((h) => `${fmtToken(h.raw, h.token.decimals)} ${h.token.symbol}`).join(" + ")}</small>
                  </span>
                </a>
              ))}
              {pendingRewards.length > 0 && (
                <a className="vw-pos-chip accent" href="#/earn">
                  <Icon name="spark" />
                  <span>
                    <strong>Rewards to claim</strong>
                    <small>{pendingRewards.map((p) => `${fmtToken(p.pending.raw, 18)} RWD`).join(" + ")}</small>
                  </span>
                </a>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Markets" subtitle="Every product on the platform, read live from Sepolia" padded={false}>
        <div className="vw-table" role="table">
          <div className="vw-tr vw-th" role="row">
            <span role="columnheader">Product</span>
            <span role="columnheader">Liquidity</span>
            <span role="columnheader">Terms</span>
            <span role="columnheader">Your position</span>
            <span role="columnheader" />
          </div>
          {PRODUCTS.map((product) => {
            const d = data ? describe(product, data) : null;
            const mine = positions.filter((p) => p.id === product.id || (product.id === "dex" && p.id.startsWith("dex-")));
            return (
              <a key={product.id} className="vw-tr" role="row" href={`#/${product.route}`}>
                <span className="vw-td-main" role="cell">
                  <TokenIcon token={d?.token} size={32} />
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      {product.kind} · Experiment {product.experiment}
                    </small>
                  </span>
                </span>
                <span role="cell" data-label="Liquidity">
                  {!product.configured ? (
                    <Badge tone="warn">Not deployed</Badge>
                  ) : !d ? (
                    <Skeleton width="80px" />
                  ) : (
                    <>
                      {tvl && tvl.byProduct[product.id] !== undefined ? (
                        <>
                          <strong>{fmtUsd(tvl.byProduct[product.id])}</strong>
                          <small className="vw-block vw-muted">{d.liquidity}</small>
                        </>
                      ) : (
                        d.liquidity
                      )}
                      {d.detail && <small className="vw-block vw-muted">{d.detail}</small>}
                    </>
                  )}
                </span>
                <span role="cell" data-label="Terms">
                  {d?.terms ?? "—"}
                </span>
                <span role="cell" data-label="Your position">
                  {!wallet.account ? <span className="vw-muted">—</span> : mine.length ? <Badge tone="good">{mine.length > 1 ? `${mine.length} positions` : "Active"}</Badge> : <span className="vw-muted">None</span>}
                </span>
                <span role="cell" className="vw-td-go">
                  <Icon name="chevron" />
                </span>
              </a>
            );
          })}
        </div>
      </Card>

      <p className="vw-muted vw-small">
        Non-custodial: contracts hold the funds and only your wallet can withdraw. No backend — the snapshot above refreshes every
        20 seconds and after each confirmed transaction.
      </p>
    </>
  );
}
