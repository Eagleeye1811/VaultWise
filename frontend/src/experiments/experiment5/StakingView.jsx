import { useState } from "react";

import Banner from "../../components/Banner";
import { TARGET_NETWORK_NAME } from "../../contracts/contractConfig";

import PoolDashboard from "./PoolDashboard";
import { POOLS, POOL_KEYS } from "./pools";

/**
 * Experiment 5 — Simulating yield farming and staking mechanisms.
 *
 * Two separate simulations behind one switch, exactly as the sheet splits them:
 *
 *   Part 1  Yield Farming     stake LPT in SimpleYieldFarm, harvest RWD
 *   Part 2  Protocol Staking  stake ABC in SimpleStaking, claim RWD
 *
 * Each part has its own contracts and its own PoolDashboard instance (keyed
 * by part, so switching never carries one part's numbers into the other).
 * The chosen part is remembered per browser as a convenience only.
 */

const STORAGE_KEY = "vaultwise.exp5.part";

function readSavedPart() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return POOL_KEYS.includes(saved) ? saved : "farm";
  } catch {
    return "farm";
  }
}

const COMPARISON = [
  ["What is staked", "An LP token / LP position (LPT)", "The ABC protocol token"],
  ["Liquidity pool needed", "Usually follows liquidity provision", "No liquidity-pool participation"],
  ["Why rewards are paid", "Additional incentive for the LP position", "For locking ABC under protocol rules"],
  ["Impermanent loss", "The underlying LP position may suffer it", "Not inherent to this position"],
  ["Main flow", "Provide liquidity → LPT → Farm → Reward", "ABC → Stake → Reward → Unstake"],
];

export default function StakingView({ account, networkName, isCorrectNetwork, refreshKey, refresh }) {
  const [part, setPart] = useState(readSavedPart);
  const pool = POOLS[part];

  const choose = (key) => {
    setPart(key);
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // storage unavailable — the choice just isn't remembered
    }
  };

  return (
    <>
      <section className="hero">
        <span className="hero-eyebrow">Experiment 5</span>
        <h1>Yield Farming &amp; Staking</h1>
        <p>
          Lock a token, earn a reward token every second, harvest it, and withdraw. Rewards follow the sheet's
          model: <code>Reward = Staked Amount × 0.001 RWD/s × Elapsed Time</code>.
        </p>

        <div className="tabs" role="tablist" aria-label="Experiment 5 part">
          {POOL_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={part === key}
              className={`tab ${part === key ? "active" : ""}`}
              onClick={() => choose(key)}
            >
              Part {POOLS[key].part} · {POOLS[key].title}
              {!POOLS[key].configured && " (not configured)"}
            </button>
          ))}
        </div>

        <p>{pool.blurb}</p>

        <div className="flow-diagram" aria-label="Flow">
          {pool.flow.map((node, index) => (
            <span key={node} style={{ display: "contents" }}>
              {index > 0 && (
                <span className="flow-edge">
                  <span aria-hidden="true">→</span>
                </span>
              )}
              <span className={`flow-node ${index === 2 ? "accent" : ""}`}>{node}</span>
            </span>
          ))}
        </div>
      </section>

      <Banner tone="info">
        Educational simulation on {TARGET_NETWORK_NAME}: the 0.001 RWD/s rate is deliberately fast for classroom
        observation. Not production-ready — never use real funds. <span className="kind kind-read">read</span> calls
        are free; <span className="kind kind-tx">tx</span> actions open MetaMask and cost Sepolia gas.
      </Banner>

      <PoolDashboard
        key={pool.key}
        pool={pool}
        account={account}
        networkName={networkName}
        isCorrectNetwork={isCorrectNetwork}
        refreshKey={refreshKey}
        refresh={refresh}
      />

      <section className="panel">
        <div className="panel-head">
          <h2>Staking vs. yield farming</h2>
          <span className="panel-note">from the experiment sheet</span>
        </div>
        <div className="activity-scroll">
          <table className="activity activity-wrap">
            <thead>
              <tr>
                <th />
                <th>Part 1 — Yield farming (SimpleYieldFarm)</th>
                <th>Part 2 — Protocol staking (SimpleStaking)</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([label, farm, staking]) => (
                <tr key={label}>
                  <td>
                    <strong>{label}</strong>
                  </td>
                  <td>{farm}</td>
                  <td>{staking}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-sub">
          Staking LPT does not itself create impermanent loss — that belongs to the AMM position behind the LP token
          (Experiment 4). Farming rewards may offset it, but nothing guarantees they will. SimpleStaking is protocol-token
          staking, not validator staking or Proof-of-Stake consensus.
        </p>
      </section>
    </>
  );
}
