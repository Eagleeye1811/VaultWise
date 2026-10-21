import { EXPLORER_ADDRESS_BASE_URL, EXPLORER_TX_BASE_URL } from "../../contracts/contractConfig";
import { shortAddress } from "../../utils/format";
import { timeAgo } from "../format";
import { usePlatform } from "../usePlatform";
import { ActionButton, Badge, Card, EmptyState, Icon, PageHeader } from "../ui";

/**
 * Activity — every transaction this browser sent through VaultWise for the
 * connected account, with a link to its receipt on Etherscan. Stored locally;
 * Etherscan stays the source of truth.
 */
export default function ActivityPage() {
  const { wallet, activity, clearActivity } = usePlatform();
  const mine = wallet.account ? activity.filter((a) => a.account?.toLowerCase() === wallet.account.toLowerCase()) : [];

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Transactions sent from this browser. The full history of your address lives on Etherscan."
        actions={
          wallet.account && (
            <>
              <a className="vw-btn vw-btn-secondary vw-btn-sm" href={`${EXPLORER_ADDRESS_BASE_URL}${wallet.account}`} target="_blank" rel="noreferrer">
                Etherscan <Icon name="external" size={12} />
              </a>
              {mine.length > 0 && (
                <button type="button" className="vw-btn vw-btn-ghost vw-btn-sm" onClick={() => clearActivity(wallet.account)}>
                  Clear
                </button>
              )}
            </>
          )
        }
      />
      <Card padded={false}>
        {!wallet.account ? (
          <EmptyState icon="clock" title="Connect a wallet to see your activity" action={<div className="vw-narrow"><ActionButton label="" /></div>} />
        ) : mine.length === 0 ? (
          <EmptyState icon="clock" title="No transactions yet" action={<a className="vw-btn vw-btn-secondary" href="#/swap">Make your first swap</a>}>
            Swaps, deposits, approvals and claims you confirm will show up here.
          </EmptyState>
        ) : (
          <ul className="vw-activity">
            {mine.map((item) => (
              <li key={`${item.hash}-${item.time}`}>
                <span className={`vw-activity-icon ${item.status}`}>
                  <Icon name={item.status === "confirmed" ? "check" : "x"} size={16} />
                </span>
                <span className="vw-activity-main">
                  <strong>{item.title}</strong>
                  <small>{item.flow !== item.title ? item.flow : ""}</small>
                </span>
                <Badge tone={item.status === "confirmed" ? "good" : "bad"}>{item.status}</Badge>
                <span className="vw-muted vw-small">{timeAgo(item.time)}</span>
                <a className="vw-link" href={`${EXPLORER_TX_BASE_URL}${item.hash}`} target="_blank" rel="noreferrer">
                  {shortAddress(item.hash, 8, 6)} <Icon name="external" size={12} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
