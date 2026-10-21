import { EXPERIMENTS } from "../../contracts/contractConfig";
import EthVaultView from "../../experiments/experiment1/EthVaultView";
import Erc4626View from "../../experiments/experiment3/Erc4626View";
import AmmView from "../../experiments/experiment4/AmmView";
import StakingView from "../../experiments/experiment5/StakingView";
import DexView from "../../experiments/experiment6/DexView";
import { usePlatform } from "../usePlatform";
import { Badge, Icon, PageHeader } from "../ui";

/**
 * Labs — the original experiment views, unchanged and still fully working.
 *
 * The platform pages are the product; these are the teaching instruments:
 * raw contract calls, decoded event logs, wiring checks. `#/experiment-N`
 * links from before the platform existed land here.
 */

const VIEWS = {
  "experiment-1": EthVaultView,
  "experiment-3": Erc4626View,
  "experiment-4": AmmView,
  "experiment-5": StakingView,
  "experiment-6": DexView,
};

export default function LabsPage({ sub }) {
  const { wallet } = usePlatform();
  const View = VIEWS[sub];

  if (View) {
    const experiment = EXPERIMENTS.find((e) => e.slug === sub);
    return (
      <>
        <div className="vw-labs-bar">
          <a className="vw-link" href="#/labs">
            <Icon name="chevron" size={12} className="vw-rot180" /> All experiments
          </a>
          <span>
            Experiment {experiment.number} · {experiment.title}
          </span>
        </div>
        <div className="vw-labs-sheet">
          <View
            account={wallet.account}
            networkName={wallet.networkName}
            isCorrectNetwork={wallet.isCorrectNetwork}
            ethBalance={wallet.ethBalance}
            refreshKey={wallet.refreshKey}
            refresh={wallet.refresh}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Labs"
        subtitle="The experiment consoles VaultWise was built from — raw contract calls, decoded events and wiring checks."
      />
      <div className="vw-grid-3">
        {[...EXPERIMENTS].sort((a, b) => a.number - b.number).map((e) => (
          <a key={e.slug} className="vw-lab-card" href={`#/labs/${e.slug}`}>
            <span className="vw-lab-num">{String(e.number).padStart(2, "0")}</span>
            <h3>{e.title}</h3>
            <p>{e.blurb}</p>
            <span className="vw-lab-foot">
              {e.configured ? <Badge tone="good">Deployed</Badge> : <Badge tone="warn">Not configured</Badge>}
              <span className="vw-link">
                Open console <Icon name="chevron" size={12} />
              </span>
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
