import { configVariable } from "hardhat/config";

import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

/**
 * VaultWise — Hardhat workspace.
 *
 * This was added for Experiment 3. It exists so that the contracts can be
 * *actually* compiled and tested locally instead of being trusted by eye, and
 * so the frontend ABI is generated from a real compilation artifact rather
 * than hand-written.
 *
 * `frontend/` remains a completely separate npm project — nothing here
 * changes how the React app is installed or run.
 *
 * Secrets: `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` are read through
 * Hardhat's keystore/`configVariable` mechanism, so no private key is ever
 * written into this repository. Set them with:
 *
 *     npx hardhat keystore set SEPOLIA_RPC_URL
 *     npx hardhat keystore set SEPOLIA_PRIVATE_KEY
 */
export default {
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatNetworkHelpers,
    hardhatVerify,
  ],

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },

  networks: {
    // `npx hardhat test` / `hardhat run` with no --network use Hardhat 3's
    // built-in in-process `default` EVM, so nothing needs declaring for it.
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },

  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
};
