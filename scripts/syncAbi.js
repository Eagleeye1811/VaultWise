import { readFileSync, writeFileSync } from "node:fs";

/**
 * VaultWise — ABI sync.
 *
 * Copies the ABIs out of the Hardhat compilation artifacts and into a single
 * generated module that the React frontend imports.
 *
 * The point is that no ABI in this repository is hand-written. If a contract
 * changes, you recompile and re-run this script; you never edit JSON by hand
 * and hope it still matches the deployed bytecode.
 *
 *   npx hardhat compile && node scripts/syncAbi.js
 *   # or simply: npm run sync-abi   (after a compile)
 */

const OUTPUT = "frontend/src/contracts/abis.generated.js";

const SOURCES = [
  {
    exportName: "MOCK_USDC_ABI",
    artifact: "artifacts/contracts/experiment3/MockUSDC.sol/MockUSDC.json",
    description: "Experiment 3 — ERC-20 underlying asset (Mock USDC, 6 decimals).",
  },
  {
    exportName: "VAULT_4626_ABI",
    artifact: "artifacts/contracts/experiment3/VaultWiseVault.sol/VaultWiseVault.json",
    description:
      "Experiment 3 — ERC-4626 tokenized vault. Includes the inherited ERC-20 share functions and the VaultWise vaultProfile() feature.",
  },
  {
    exportName: "ETH_VAULT_ABI",
    artifact: "artifacts/contracts/experiment1/VaultWiseVault.sol/VaultWiseVault.json",
    description: "Experiment 1 — the original plain-ETH vault, kept so its deployment stays usable.",
  },
  {
    exportName: "MOCK_ERC20_ABI",
    artifact: "artifacts/contracts/experiment4/MockERC20.sol/MockERC20.json",
    description:
      "Generic 18-decimal test token (contracts/experiment4/MockERC20.sol). Experiment 4 deploys it as TKA/TKB; Experiment 5 reuses it as LPT, ABC and RWD.",
  },
  {
    exportName: "SIMPLE_AMM_ABI",
    artifact: "artifacts/contracts/experiment4/SimpleAMM.sol/SimpleAMM.json",
    description:
      "Experiment 4 — no-fee constant-product AMM. Includes the inherited ERC-20 functions of its vwLP shares.",
  },
  {
    exportName: "SIMPLE_YIELD_FARM_ABI",
    artifact: "artifacts/contracts/experiment5/SimpleYieldFarm.sol/SimpleYieldFarm.json",
    description:
      "Experiment 5, Part 1 — LP-token yield farm (stake LPT, harvest RWD). Its tokens use MOCK_ERC20_ABI.",
  },
  {
    exportName: "SIMPLE_STAKING_ABI",
    artifact: "artifacts/contracts/experiment5/SimpleStaking.sol/SimpleStaking.json",
    description:
      "Experiment 5, Part 2 — protocol-token staking (stake ABC, claim RWD). Its tokens use MOCK_ERC20_ABI.",
  },
  {
    exportName: "DEX_TOKEN_ABI",
    artifact: "artifacts/contracts/experiment6/DexMockERC20.sol/DexMockERC20.json",
    description: "Experiment 6 — public-mint 18-decimal test token (the sheet's MockERC20), deployed as DXA/DXB/DXC.",
  },
  {
    exportName: "DEX_FACTORY_ABI",
    artifact: "artifacts/contracts/experiment6/Factory.sol/Factory.json",
    description: "Experiment 6 — DEX Factory: createPair, getPair, allPairs.",
  },
  {
    exportName: "DEX_ROUTER_ABI",
    artifact: "artifacts/contracts/experiment6/Router.sol/Router.json",
    description: "Experiment 6 — DEX Router: liquidity, exact-input swaps (multi-hop), quotes.",
  },
  {
    exportName: "DEX_PAIR_ABI",
    artifact: "artifacts/contracts/experiment6/Pair.sol/Pair.json",
    description: "Experiment 6 — DEX Pair: reserves, mint/burn/swap, and its own ERC-20 LP token.",
  },
  {
    exportName: "PRICE_ORACLE_ABI",
    artifact: "artifacts/contracts/oracle/PriceOracle.sol/PriceOracle.json",
    description: "PriceOracle — token → Chainlink feed registry with validated, 18-decimal USD prices.",
  },
];

function loadArtifact(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path}. Run \`npx hardhat compile\` first.\n  ${error.message}`
    );
  }
}

const blocks = SOURCES.map(({ exportName, artifact, description }) => {
  const { abi, contractName } = loadArtifact(artifact);

  if (!Array.isArray(abi) || abi.length === 0) {
    throw new Error(`Artifact ${artifact} has an empty ABI.`);
  }

  const functions = abi.filter((e) => e.type === "function").length;
  const events = abi.filter((e) => e.type === "event").length;
  console.log(
    `  ${exportName.padEnd(21)} <- ${contractName.padEnd(16)} ${functions} functions, ${events} events`
  );

  return [
    "/**",
    ` * ${description}`,
    ` * Source: ${artifact}`,
    ` */`,
    `export const ${exportName} = ${JSON.stringify(abi, null, 2)};`,
  ].join("\n");
});

const header = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by \`scripts/syncAbi.js\` from the Hardhat compilation artifacts in
 * \`artifacts/\`. Every ABI below therefore matches the exact bytecode that
 * \`npx hardhat compile\` produced from \`contracts/\`.
 *
 * To refresh after changing a contract:
 *
 *     npx hardhat compile
 *     npm run sync-abi
 *
 * Contract *addresses* are not here — they live in \`contractConfig.js\`, which
 * remains the single place the frontend looks up what is deployed where.
 *
 * Generated: ${new Date().toISOString()}
 */
`;

console.log("\nSyncing ABIs from Hardhat artifacts:");
writeFileSync(OUTPUT, `${header}\n${blocks.join("\n\n")}\n`);
console.log(`\nWrote ${OUTPUT}\n`);
