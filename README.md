# VaultWise

**An open DeFi platform for Ethereum: tokenized vaults, an AMM DEX, liquidity pools, yield farming and staking, priced in USD by Chainlink, all in one web app.**

![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity)
![Hardhat](https://img.shields.io/badge/Hardhat-3-f0d43a)
![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.x-4e5ee4)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![ethers.js](https://img.shields.io/badge/ethers.js-6-2535a0)
![Network](https://img.shields.io/badge/network-Sepolia-8a63d2)
![License](https://img.shields.io/badge/license-MIT-green)

> [!WARNING]
> VaultWise runs on the **Sepolia testnet** and has **not been audited**. Don't deploy it to mainnet or use it with real funds.

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Smart contracts](#smart-contracts)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [Deployed contracts (Sepolia)](#deployed-contracts-sepolia)
- [Project structure](#project-structure)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

VaultWise brings the core DeFi building blocks together in one non-custodial interface:

- **Earn**: deposit into an ERC-4626 tokenized vault, an ETH vault, a yield farm or a staking pool.
- **Swap**: trade through a Uniswap V2-style DEX with multi-hop routing, slippage protection and deadlines.
- **Provide liquidity**: add liquidity to constant-product pools, receive LP tokens, and create new pairs without permission.
- **Track**: see every position, balance and transaction in one place, valued in USD.
- **Price**: every USD value comes from Chainlink Data Feeds, validated on-chain by the VaultWise `PriceOracle`.

The app has no backend. It reads state from the chain, and your wallet signs every write.

## Features

| Page          | Route         | What it does                                                                                     |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| **Overview**  | `#/overview`  | Total value locked, live liquidity, product terms and your open positions                        |
| **Swap**      | `#/swap`      | Best-route quoting (direct or multi-hop), slippage and deadline, and a check against oracle prices |
| **Pools**     | `#/pools`     | Add or remove liquidity, view reserves, `k`, LP supply and your share; create new pairs          |
| **Earn**      | `#/earn`      | ERC-4626 USDC vault, ETH vault, LP yield farm and token staking, with live rewards and USD APR   |
| **Portfolio** | `#/portfolio` | Net worth, wallet balances and every open position, valued in USD                                |
| **Prices**    | `#/prices`    | Every USD price in use, its Chainlink feed, its age and its status                               |
| **Faucet**    | `#/faucet`    | Mint test tokens (public for DEX tokens; owner-only for the others, plus reward-pool funding)    |
| **Activity**  | `#/activity`  | Transactions sent from this browser, with Etherscan links                                        |
| **Labs**      | `#/labs`      | Low-level developer consoles for each contract                                                   |

**How the app behaves:**

- **Read-only access.** With no wallet connected, the app reads through a public Sepolia RPC, so visitors can still browse the markets. Data refreshes every 20 seconds and after every confirmed transaction.
- **Guided writes.** Each action runs as a step-by-step flow (approve, then act). A toast follows each step until its receipt arrives. Approvals are for the exact amount, never unlimited.
- **Readable errors.** Contract reverts and wallet errors are shown as plain-language messages.
- **USD everywhere, never guessed.** With the oracle deployed, balances, positions, pool liquidity and TVL are shown in USD, farms and staking show an APR, and every swap is compared with the oracle rate. A stale or invalid price is never used; the value shows as "—" instead.

## Architecture

```text
┌───────────────────────────────┐
│    React 19 + Vite frontend   │
│   (pages, flows, live state)  │
└───────────────┬───────────────┘
                │ ethers.js v6
        ┌───────┴────────┐
        ▼                ▼
    MetaMask        Public RPC
    (signing)       (read-only)
        └───────┬────────┘
                ▼
┌───────────────────────────────┐
│       Ethereum (Sepolia)      │
│                               │
│  Vaults   ERC-4626 · ETH      │
│  DEX      Factory · Pair ·    │
│           Router · LPFarm     │
│  AMM      Constant-product    │
│  Rewards  YieldFarm · Staking │
│  Oracle   PriceOracle         │ ──▶ Chainlink Data Feeds
└───────────────────────────────┘
```

| Layer            | Technology                                                        |
| ---------------- | ----------------------------------------------------------------- |
| Smart contracts  | Solidity 0.8.28, OpenZeppelin Contracts 5                         |
| Price data       | Chainlink Data Feeds (`AggregatorV3Interface`)                    |
| Tooling          | Hardhat 3 (compile, test, deploy, encrypted keystore)             |
| Frontend         | React 19, Vite, plain CSS                                         |
| Web3 library     | ethers.js 6                                                       |
| Wallet           | MetaMask (EIP-1193)                                               |
| Network          | Ethereum Sepolia (chain ID `11155111`)                            |

## Smart contracts

| Module | Contract | Description |
| ------ | -------- | ----------- |
| **ERC-4626 Vault** | `VaultWiseVault` | Tokenized vault over USDC. It issues `vwUSDC` shares, which are a proportional, transferable claim on the vault's assets. It also exposes on-chain `vaultProfile()` metadata. |
| | `MockUSDC` | 6-decimal ERC-20 test asset with owner-only minting |
| **ETH Vault** | `VaultWiseVault` (ETH) | Simple per-user ETH deposit and withdrawal vault |
| **DEX** | `Factory` | Permissionless `createPair`. Each pair is deployed with CREATE2, so its address is predictable. |
| | `Pair` | Constant-product pool and LP token (`VWDEX-LP`) with a 0.3% swap fee. 1,000 LP are locked on the first deposit. |
| | `Router` | Safe entry point for adding and removing liquidity and for multi-hop swaps, with `amountOutMin` and `deadline` checks |
| | `LPFarm` | Stake LP tokens and earn rewards, using `accRewardPerShare` accounting (no loops over users) |
| | `DexMockERC20` | Test tokens (DXA, DXB, DXC) that anyone can mint |
| **AMM Pool** | `SimpleAMM` | Two-token `x · y = k` pool that is also its own LP token (`vwLP`) |
| **Rewards** | `SimpleYieldFarm` | Stake LP-style tokens to earn a reward token: `harvest`, `withdraw`, `exit` |
| | `SimpleStaking` | Stake the protocol token to earn a reward token: `claimReward`, `unstake`, `exit` |
| | `MockERC20` | 18-decimal test tokens with owner-only minting |
| **Oracle** | `PriceOracle` | Maps each token to a Chainlink feed. Every read checks for a positive answer, a valid timestamp and a fresh round (a staleness window per feed), and prices are normalised to 18 decimals. Provides `getPrice`, `getValue` and a non-reverting `tryGetPrice` for dashboards. Ownership transfers in two steps. |

### Price feeds

The platform's tokens are testnet assets with no market of their own, so each one follows a real Sepolia Chainlink feed as its reference price. The mapping lives in [`scripts/lib/oracleConfig.js`](scripts/lib/oracleConfig.js) and is shown on the app's **Prices** page.

| Token | Reference feed | Max age |
| ----- | -------------- | ------- |
| ETH, DXA, LPT | ETH / USD | 2 h |
| DXB | BTC / USD | 2 h |
| DXC | LINK / USD | 2 h |
| RWD (both reward tokens) | SNX / USD | 2 h |
| USDC, TKB | USDC / USD | 26 h |
| TKA | DAI / USD | 26 h |
| ABC | FORTH / USD | 26 h |

Each window is about one update longer than the feed's heartbeat, as measured on Sepolia: hourly for the 2 h feeds, daily for the 26 h ones. Vault shares and LP tokens have no feed. They're valued from the tokens they redeem for.

### Key formulas

```text
ERC-4626 share value   assets = totalAssets() × shares / totalSupply()
DEX swap output        out = in·997·reserveOut / (reserveIn·1000 + in·997)
DEX LP mint            first: √(a0·a1) − 1000     later: min(a0·S/r0, a1·S/r1)
Staking reward         reward = staked × rewardRate × elapsedSeconds
```

All integer divisions round in the protocol's favour.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) **22 or later** (tested on 24)
- [MetaMask](https://metamask.io/) set to the **Sepolia** network
- Some Sepolia ETH for gas, from a faucet such as [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia) or [QuickNode](https://faucet.quicknode.com/ethereum/sepolia)

### Run the app

```bash
git clone https://github.com/Eagleeye1811/VaultWise.git
cd VaultWise/frontend
cp .env.example .env.local   # preconfigured for the live Sepolia deployment
npm install
npm run dev
```

Open <http://localhost:5173>, click **Connect Wallet**, then go to **Faucet** to get test tokens.

The repository contains two separate npm projects: the **frontend** (`frontend/`) and the **contracts workspace** (the repository root). To use the app, you only need the frontend.

## Configuration

The frontend reads contract addresses from Vite environment variables. `frontend/.env.example` already points at the [live Sepolia deployment](#deployed-contracts-sepolia), so copying it to `.env.local` is all the setup most people need.

If you [deploy your own contracts](#deployment), replace the matching values. Each deploy script prints the exact lines to paste. The variables are:

| Variable | Contract |
| -------- | -------- |
| `VITE_SEPOLIA_RPC_URL` | *(optional)* Read-only RPC. Defaults to publicnode.com. |
| `VITE_CONTRACT_ADDRESS` | ETH vault |
| `VITE_USDC_ADDRESS`, `VITE_VAULT4626_ADDRESS` | MockUSDC and the ERC-4626 vault |
| `VITE_TOKEN_A_ADDRESS`, `VITE_TOKEN_B_ADDRESS`, `VITE_AMM_ADDRESS`, `VITE_AMM_DEPLOY_BLOCK` | AMM pool and its tokens |
| `VITE_LPT_ADDRESS`, `VITE_FARM_RWD_ADDRESS`, `VITE_YIELD_FARM_ADDRESS` | Yield farm |
| `VITE_ABC_ADDRESS`, `VITE_STAKING_RWD_ADDRESS`, `VITE_STAKING_ADDRESS` | Staking pool |
| `VITE_DEX_FACTORY_ADDRESS`, `VITE_DEX_ROUTER_ADDRESS`, `VITE_DEX_TOKEN_{A,B,C}_ADDRESS` | DEX |
| `VITE_ORACLE_ADDRESS` | PriceOracle. *(Optional.)* Without it, values are shown in tokens only. |

Restart `npm run dev` after changing these, because Vite reads env files only at startup. If a product's addresses are missing, the app shows a warning and disables its actions rather than calling the wrong contract.

> [!IMPORTANT]
> Every `VITE_*` value is embedded in the public browser bundle. Put only contract addresses here, never keys or secrets.

## Development

From the **repository root**:

```bash
npm install
npm run compile      # compile all contracts
npm test             # run the full test suite (297 tests)
npm run sync-abi     # regenerate frontend ABIs from compiled artifacts
```

Run `npm run sync-abi` after any contract change. The frontend's `abis.generated.js` is generated from the Hardhat artifacts and shouldn't be edited by hand.

### Targeted tests and local simulations

| Command | Purpose |
| ------- | ------- |
| `npm run test:exp5` | Yield farm and staking tests |
| `npm run test:exp6` | DEX tests (Factory, Pair, Router, LPFarm) |
| `npm run test:oracle` | PriceOracle tests and the frontend's USD maths |
| `npm run demo` | Run the full ERC-4626 vault lifecycle on a local chain |
| `npm run demo:exp4` | Run the AMM pool lifecycle on a local chain |
| `npm run demo:exp5` | Run the farming and staking lifecycle on a local chain |
| `npm run demo:exp6` | Run the DEX scenarios (swaps, multi-hop, slippage, reverts) |

### Frontend

From `frontend/`:

```bash
npm run dev       # development server
npm run build     # production build into frontend/dist
npm run preview   # serve the production build
npm run lint      # static analysis (oxlint)
```

## Deployment

Deployment secrets are kept in Hardhat's **encrypted keystore**, never in files:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL       # e.g. an Alchemy or Infura endpoint
npx hardhat keystore set SEPOLIA_PRIVATE_KEY   # a dedicated testnet-only key
npx hardhat keystore set ETHERSCAN_API_KEY     # optional, for source verification
```

Deploy each module (run `npm test` first):

| Module | Command |
| ------ | ------- |
| ERC-4626 vault | `npm run deploy:sepolia` |
| AMM pool | `npm run deploy:exp4:sepolia` |
| Yield farm and staking | `npm run deploy:exp5:sepolia` |
| DEX | `npm run deploy:exp6:sepolia` |
| Price oracle | `npm run deploy:oracle:sepolia` |

Each script checks the deployed wiring before it reports success, writes a record to `deployments/`, and prints the `VITE_*` lines for your frontend env file. To dry-run on the in-process Hardhat chain, leave off `:sepolia` (for example, `npm run deploy:exp6`).

To check deployments against the frontend config (read-only, no key needed):

```bash
npm run verify:sepolia   # ERC-4626 vault
npm run verify:exp4      # AMM pool
npm run verify:exp5      # Yield farm and staking
npm run verify:oracle    # Price oracle (before deploying: checks every feed is live)
```

## Deployed contracts (Sepolia)

| Contract | Address |
| -------- | ------- |
| ETH Vault | [`0x172b07bab2415A7EF32eA150c499CFB9B6cc236a`](https://sepolia.etherscan.io/address/0x172b07bab2415A7EF32eA150c499CFB9B6cc236a) |
| MockUSDC | [`0x85016FBbE60423B5aB92B6b9d9646FCAA51628e5`](https://sepolia.etherscan.io/address/0x85016FBbE60423B5aB92B6b9d9646FCAA51628e5) |
| ERC-4626 Vault (`vwUSDC`) | [`0x4fc3c56482DC1a4c9411A7C5890702284Af6e070`](https://sepolia.etherscan.io/address/0x4fc3c56482DC1a4c9411A7C5890702284Af6e070) |
| AMM Token A (TKA) | [`0x785BD01f7EA2BFD11f7Dfa3e53129b83Ab807138`](https://sepolia.etherscan.io/address/0x785BD01f7EA2BFD11f7Dfa3e53129b83Ab807138) |
| AMM Token B (TKB) | [`0xfD6f659d80e0E7aF1bbddA58c33c73C855C2114b`](https://sepolia.etherscan.io/address/0xfD6f659d80e0E7aF1bbddA58c33c73C855C2114b) |
| SimpleAMM | [`0x14bDB27779bC6A8DA677e7674B09105AeFEb6ceb`](https://sepolia.etherscan.io/address/0x14bDB27779bC6A8DA677e7674B09105AeFEb6ceb) |
| Farm LP Token (LPT) | [`0xEd305BEcD7fFc199Da9883E2a8d56f71fE01aDA6`](https://sepolia.etherscan.io/address/0xEd305BEcD7fFc199Da9883E2a8d56f71fE01aDA6) |
| Farm Reward Token (RWD) | [`0x46FD1d37F0dd37E03443A6Bc8B36d34e78304443`](https://sepolia.etherscan.io/address/0x46FD1d37F0dd37E03443A6Bc8B36d34e78304443) |
| SimpleYieldFarm | [`0xcE26f526B5Dd6F0b2DEE9eE8575B224967b22B30`](https://sepolia.etherscan.io/address/0xcE26f526B5Dd6F0b2DEE9eE8575B224967b22B30) |
| Protocol Token (ABC) | [`0x36ee3668B13Efe258C1AC229C0A043c806B99683`](https://sepolia.etherscan.io/address/0x36ee3668B13Efe258C1AC229C0A043c806B99683) |
| Staking Reward Token (RWD) | [`0xd47c4EA94928546815919a2B1D67F363A4BF3182`](https://sepolia.etherscan.io/address/0xd47c4EA94928546815919a2B1D67F363A4BF3182) |
| SimpleStaking | [`0x7e2aB3fd700a00bcF9E8CD8285b0934580454359`](https://sepolia.etherscan.io/address/0x7e2aB3fd700a00bcF9E8CD8285b0934580454359) |
| DEX Token A (DXA) | [`0xEE5090e062015fADBE15d9dBE213c10112AC701e`](https://sepolia.etherscan.io/address/0xEE5090e062015fADBE15d9dBE213c10112AC701e) |
| DEX Token B (DXB) | [`0x19CBfe5efEfa8Ab20A0AD5FA9F0CA7E9b6E85633`](https://sepolia.etherscan.io/address/0x19CBfe5efEfa8Ab20A0AD5FA9F0CA7E9b6E85633) |
| DEX Token C (DXC) | [`0xa30B7353F1869B20ED7eCF05586C1F35722952B9`](https://sepolia.etherscan.io/address/0xa30B7353F1869B20ED7eCF05586C1F35722952B9) |
| DEX Factory | [`0x5b61081462e34e008B4D863Dd65506dd7863cC08`](https://sepolia.etherscan.io/address/0x5b61081462e34e008B4D863Dd65506dd7863cC08) |
| DEX Router | [`0x24024e2590c0d1c41fb0b7b960e6a8Ca43B32658`](https://sepolia.etherscan.io/address/0x24024e2590c0d1c41fb0b7b960e6a8Ca43B32658) |

You don't need to configure pair addresses. The app finds them with `Factory.getPair`. Full deployment records, including transaction hashes, are in [`deployments/`](deployments/).

## Project structure

```text
VaultWise/
├── contracts/               Solidity sources, grouped by module
│   └── mocks/               Hostile-token fixtures used only by tests
├── test/                    Hardhat + Mocha test suites (contracts and frontend logic)
├── scripts/                 Deploy, verify, lifecycle-simulation and ABI-sync scripts
├── deployments/             Deployment records per network
├── hardhat.config.js        Compiler, networks, keystore-backed secrets
└── frontend/
    ├── .env.example         Contract address template
    └── src/
        ├── platform/        App shell, pages, shared UI, product registry
        ├── hooks/           Wallet, transactions, protocol data snapshot
        ├── contracts/       Address config and generated ABIs
        ├── experiments/     Labs developer consoles
        └── utils/           Decimal-safe formatting, error translation
```

## Security

> [!CAUTION]
> These contracts have **not been audited** and are intended for testnets. Don't send real assets to them.

**Measures already in place:**

- **Battle-tested building blocks.** ERC-20 and ERC-4626 accounting comes from OpenZeppelin 5, and no ERC-4626 function is overridden. OpenZeppelin's virtual shares protect against share-inflation attacks.
- **Reentrancy protection.** Every state-changing function uses `ReentrancyGuardTransient` (EIP-1153) and follows checks-effects-interactions. Tests try re-entering through hostile tokens.
- **Safe token handling.** `SafeERC20` is used on every transfer. Fee-on-transfer staking tokens are detected and rejected.
- **On-chain slippage and deadline checks** in the DEX Router (`amountOutMin`, `amountAMin`/`amountBMin`, `deadline`). The Pair re-checks the fee-adjusted invariant after every swap.
- **No privileged backdoors.** There are no owners, pause switches or fee switches on pools, vaults, farms or the DEX. Only the test tokens have owner-restricted minting.
- **Rounding always favours the protocol**, so it never pays out more than it holds.
- **Rewards are capped by funding.** Staking contracts pay only from their own balance, and you can always withdraw your principal.

**Known limitations:**

- The `SimpleAMM` pool has no swap fee and no on-chain `minAmountOut`. The app applies slippage limits on the client side.
- Reward rates are fixed constants with no emission schedule.
- The oracle owner chooses which Chainlink feed prices each token, and can change it. That is the oracle's only privileged power. The current mapping is public on the Prices page and on-chain (`feedOf`).
- Reward APRs are computed from the fixed classroom emission rate and the reference prices, so they can be very high (thousands of percent).
- Rebasing tokens aren't supported. Fee-on-transfer tokens aren't supported by the AMM or the DEX.

**Secrets:** deployment keys live only in Hardhat's encrypted keystore. `.gitignore` excludes `.env*`, `*.key` and `*.pem`. Always use a dedicated testnet wallet.

To report a vulnerability, please contact the maintainer privately rather than opening a public issue.

## Roadmap

- [ ] WalletConnect and multi-wallet support
- [x] Chainlink price feeds and USD valuation
- [ ] DAO governance and on-chain voting
- [ ] Flash-loan resistance hardening
- [ ] Multi-chain deployment (Polygon and other EVM testnets)
- [ ] Independent security audit

## Contributing

Contributions are welcome.

1. Fork the repository and create a feature branch.
2. Run `npm test` (root) and `npm run lint` (frontend) before opening a pull request.
3. If you change a contract, run `npm run compile && npm run sync-abi` and commit the regenerated ABIs.
4. Keep pull requests focused, and describe what changed and why.

## License

Released under the [MIT License](LICENSE).
