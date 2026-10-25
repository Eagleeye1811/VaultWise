import { useEffect, useState } from "react";
import { Contract } from "ethers";

import { EXPLORER_ADDRESS_BASE_URL, ORACLE_ADDRESS, ORACLE_ETH, PRICE_ORACLE_ABI, isOracleConfigured } from "../../contracts/contractConfig";
import { getPublicProvider } from "../../hooks/useProtocolData";
import { shortAddress } from "../../utils/format";
import { fmtPrice, timeAgo } from "../format";
import { usePlatform } from "../usePlatform";
import { TOKENS } from "../registry";
import { Badge, Card, EmptyState, Icon, Notice, PageHeader, Skeleton, Stat, TokenIcon } from "../ui";

/**
 * Prices — every USD price the platform uses, where it comes from and how
 * fresh it is. Prices come from the snapshot (PriceOracle.tryGetPrice); the
 * feed behind each one (aggregator, description, staleness window) is read
 * once here, since it only changes when the oracle owner re-points a token.
 */

const ETH = { id: "ETH", symbol: "ETH", name: "Sepolia Ether", decimals: 18, hue: "#4a5785", address: ORACLE_ETH };

/** Tokens with a market of their own. Vault and LP shares are valued from what they redeem for. */
const ASSETS = [ETH, ...TOKENS.filter((t) => t.faucet !== null)];

const STATUS = {
  ok: { tone: "good", label: "Live" },
  stale: { tone: "warn", label: "Stale", title: "The last round is older than this feed's staleness window. The price is not used." },
  invalid: { tone: "bad", label: "Invalid", title: "The feed returned no usable answer. The price is not used." },
  noFeed: { tone: "neutral", label: "No feed", title: "The oracle owner has not assigned a feed to this token." },
  error: { tone: "bad", label: "Unreadable", title: "The oracle could not be read." },
};

const AGGREGATOR_ABI = ["function description() view returns (string)"];

/** feedOf + description for every asset, read once. */
function useFeeds() {
  const [feeds, setFeeds] = useState(null);
  useEffect(() => {
    if (!isOracleConfigured) return undefined;
    let cancelled = false;
    const provider = getPublicProvider();
    const oracle = new Contract(ORACLE_ADDRESS, PRICE_ORACLE_ABI, provider);
    Promise.all(
      ASSETS.map(async (asset) => {
        try {
          const [aggregator, maxStaleness] = await oracle.feedOf(asset.address);
          if (/^0x0{40}$/.test(aggregator)) return [asset.id, null];
          const description = await new Contract(aggregator, AGGREGATOR_ABI, provider).description().catch(() => null);
          return [asset.id, { aggregator, maxStaleness: Number(maxStaleness), description }];
        } catch {
          return [asset.id, null];
        }
      })
    ).then((entries) => {
      if (!cancelled) setFeeds(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return feeds;
}

const hours = (seconds) => `${Math.round(seconds / 3600)} h`;

export default function PricesPage() {
  const { protocol } = usePlatform();
  const data = protocol.data ?? protocol.staleData;
  const feeds = useFeeds();

  if (!isOracleConfigured)
    return (
      <>
        <PageHeader title="Prices" subtitle="USD reference prices from Chainlink Data Feeds." />
        <Card>
          <EmptyState icon="pulse" title="Price oracle not deployed">
            Deploy it with <code>npm run deploy:oracle:sepolia</code> from the repository root, set <code>VITE_ORACLE_ADDRESS</code> in{" "}
            <code>frontend/.env.local</code> and restart the dev server. Until then, values are shown in tokens only.
          </EmptyState>
        </Card>
      </>
    );

  const rows = ASSETS.map((asset) => ({ asset, entry: data?.prices?.[asset.id], feed: feeds?.[asset.id] }));
  const live = rows.filter((r) => r.entry?.status === "ok");
  const oldest = live.reduce((min, r) => Math.min(min, r.entry.updatedAt), Infinity);

  return (
    <>
      <PageHeader
        title="Prices"
        subtitle="USD reference prices from Chainlink Data Feeds, validated on-chain by the VaultWise PriceOracle."
        actions={
          <a className="vw-btn vw-btn-secondary vw-btn-sm" href={`${EXPLORER_ADDRESS_BASE_URL}${ORACLE_ADDRESS}`} target="_blank" rel="noreferrer">
            Oracle contract <Icon name="external" size={12} />
          </a>
        }
      />
      <div className="vw-stats-row">
        <Stat label="Assets priced" value={data ? `${live.length} / ${ASSETS.length}` : null} loading={!data} sub="With a live, fresh feed" />
        <Stat label="Oldest price in use" value={data ? (live.length ? timeAgo(oldest * 1000) : "—") : null} loading={!data} sub="Each feed has its own window" />
        <Stat label="Source" value="Chainlink" sub="Sepolia Data Feeds" />
      </div>

      <Card title="Price feeds" subtitle="Refreshed with the rest of the protocol every 20 seconds" padded={false}>
        <div className="vw-table" role="table">
          <div className="vw-tr vw-th vw-tr-prices" role="row">
            <span role="columnheader">Asset</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Reference feed</span>
            <span role="columnheader">Updated</span>
            <span role="columnheader">Status</span>
          </div>
          {rows.map(({ asset, entry, feed }) => {
            const status = STATUS[entry?.status] ?? null;
            return (
              <div key={asset.id} className="vw-tr vw-tr-prices" role="row">
                <span className="vw-td-main" role="cell">
                  <TokenIcon token={asset} size={32} />
                  <span>
                    <strong>{asset.symbol}</strong>
                    <small>{asset.name}</small>
                  </span>
                </span>
                <span role="cell" data-label="Price" className="vw-num">
                  {!data ? <Skeleton width="70px" /> : entry?.price ? <span className={entry.status === "ok" ? "" : "vw-muted"}>{fmtPrice(entry.price)}</span> : "—"}
                </span>
                <span role="cell" data-label="Reference feed">
                  {feeds === null ? (
                    <Skeleton width="110px" />
                  ) : feed ? (
                    <>
                      <a className="vw-link" href={`${EXPLORER_ADDRESS_BASE_URL}${feed.aggregator}`} target="_blank" rel="noreferrer">
                        {feed.description ?? shortAddress(feed.aggregator)} <Icon name="external" size={12} />
                      </a>
                      <small className="vw-block vw-muted">Max age {hours(feed.maxStaleness)}</small>
                    </>
                  ) : (
                    <span className="vw-muted">None</span>
                  )}
                </span>
                <span role="cell" data-label="Updated">
                  {entry?.updatedAt ? timeAgo(entry.updatedAt * 1000) : "—"}
                </span>
                <span role="cell" data-label="Status">
                  {status ? (
                    <Badge tone={status.tone} title={status.title}>
                      {status.label}
                    </Badge>
                  ) : (
                    <Skeleton width="50px" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Notice>
        VaultWise&apos;s tokens are testnet assets with no market of their own, so each one follows a real Chainlink feed as its reference price.
        For example, DXA follows ETH / USD. The oracle owner sets this mapping, and the Reference feed column shows it. Vault shares and LP tokens
        are valued from the tokens they redeem for. A price that is stale or invalid is never used: values that depend on it show as —.
      </Notice>
    </>
  );
}
