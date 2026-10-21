import { useState } from "react";
import { parseUnits } from "ethers";

import { MOCK_ERC20_ABI, STAKING_ADDRESS, YIELD_FARM_ADDRESS } from "../../contracts/contractConfig";
import { shortAddress } from "../../utils/format";
import { writeContract } from "../actions";
import { fmtToken } from "../format";
import { usePlatform } from "../usePlatform";
import { TOKENS } from "../registry";
import { ActionButton, Badge, Card, Icon, Notice, PageHeader, Skeleton, TokenIcon } from "../ui";

/**
 * Faucet — mint the platform's test tokens.
 *
 * The DEX tokens have a public mint, so anyone can top up. The other mocks
 * are Ownable: the page checks `owner()` and only offers minting to the
 * deploying wallet, which is also how the reward pools get funded (mint RWD
 * straight to the farm or staking contract).
 */

const AMOUNTS = ["100", "1000", "10000"];
const FUND_TARGET = {
  RWD_F: { address: YIELD_FARM_ADDRESS, label: "Yield farm" },
  RWD_S: { address: STAKING_ADDRESS, label: "Staking pool" },
};

function FaucetRow({ token }) {
  const { wallet, run } = usePlatform();
  const [amount, setAmount] = useState("1000");
  const [target, setTarget] = useState("me");
  const isOwner = token.owner && wallet.account && token.owner.toLowerCase() === wallet.account.toLowerCase();
  const allowed = token.faucet === "public" || isOwner;
  const fund = FUND_TARGET[token.id];
  const recipient = target === "pool" && fund ? fund.address : wallet.account;
  const flowKey = `mint-${token.id}`;

  const mint = () =>
    run({
      key: flowKey,
      title: `Mint ${amount} ${token.symbol}`,
      steps: [
        {
          label: `Mint ${Number(amount).toLocaleString("en-US")} ${token.symbol}${target === "pool" ? ` to ${fund.label.toLowerCase()}` : ""}`,
          send: async () => (await writeContract(token.address, MOCK_ERC20_ABI)).mint(recipient, parseUnits(amount, token.decimals)),
        },
      ],
    });

  return (
    <div className="vw-faucet-row">
      <span className="vw-td-main">
        <TokenIcon token={token} size={36} />
        <span>
          <strong>{token.symbol}</strong>
          <small>
            {token.name} · {token.product}
          </small>
        </span>
      </span>
      <span className="vw-faucet-access">
        {token.faucet === "public" ? (
          <Badge tone="good">Open mint</Badge>
        ) : isOwner ? (
          <Badge tone="accent">You are the owner</Badge>
        ) : (
          <Badge tone="warn" title={token.owner ? `Owner: ${token.owner}` : undefined}>
            Deployer only{token.owner ? ` · ${shortAddress(token.owner, 6, 4)}` : ""}
          </Badge>
        )}
        {wallet.account && (
          <small className="vw-muted">
            You hold {fmtToken(token.balance, token.decimals)} {token.symbol}
          </small>
        )}
      </span>
      <span className="vw-faucet-controls">
        <span className="vw-chips">
          {AMOUNTS.map((a) => (
            <button key={a} type="button" className={amount === a ? "active" : ""} onClick={() => setAmount(a)} disabled={!allowed}>
              {Number(a).toLocaleString("en-US")}
            </button>
          ))}
        </span>
        {fund && isOwner && (
          <select className="vw-select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Recipient">
            <option value="me">To my wallet</option>
            <option value="pool">Fund {fund.label.toLowerCase()}</option>
          </select>
        )}
        <ActionButton
          label="Mint"
          block={false}
          variant={allowed ? "primary" : "secondary"}
          flowKey={flowKey}
          onClick={mint}
          disabledReason={allowed ? "" : "Owner only"}
        />
      </span>
    </div>
  );
}

export default function FaucetPage() {
  const { protocol } = usePlatform();
  const data = protocol.data;
  const mintable = TOKENS.filter((t) => t.faucet);

  return (
    <>
      <PageHeader title="Faucet" subtitle="Free test tokens for every VaultWise market. They have no value — that is the point." />
      <Notice tone="info">
        You also need a little Sepolia ETH for gas. Get some from the{" "}
        <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">
          Google Cloud faucet <Icon name="external" size={12} />
        </a>{" "}
        or{" "}
        <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noreferrer">
          Alchemy faucet <Icon name="external" size={12} />
        </a>
        .
      </Notice>
      <Card padded={false}>
        {!data ? (
          <div className="vw-pad vw-stack">
            <Skeleton height="56px" />
            <Skeleton height="56px" />
          </div>
        ) : (
          mintable.map((t) => data.tokens[t.id] && <FaucetRow key={t.id} token={data.tokens[t.id]} />)
        )}
      </Card>
      <p className="vw-muted vw-small">
        Owner-only tokens (USDC, TKA, TKB, LPT, ABC, RWD) were deployed as Ownable mocks; the deploying wallet can mint them here, including
        RWD straight into the farm or staking contract to fund rewards.
      </p>
    </>
  );
}
