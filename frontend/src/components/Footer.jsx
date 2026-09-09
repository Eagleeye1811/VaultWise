import { EXPERIMENTS } from "../contracts/contractConfig";

/** Site footer — names the experiment currently on screen. */
export default function Footer({ activeExperiment }) {
  const experiment = EXPERIMENTS.find((e) => e.slug === activeExperiment) ?? EXPERIMENTS[0];

  return (
    <footer className="footer">
      <span>
        VaultWise · Experiment {experiment.number} — {experiment.title}
      </span>
      <span className="footer-warn">Sepolia testnet only. Never use real funds.</span>
    </footer>
  );
}
