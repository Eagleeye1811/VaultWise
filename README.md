# VaultWise

> Your simple decentralized asset vault.

**Experiment 1 — Building an Advanced DApp using React and Ethers.js**
**Experiment 3 — Deploying and Interacting with ERC-4626 Vault Contracts**
**Experiment 4 — AMM Liquidity Pool**
**Experiment 5 — Simulating Yield Farming and Staking Mechanisms**
**Experiment 6 — Building a Decentralised Exchange (DEX) Prototype**

---

## The VaultWise platform (frontend)

The React app is a single DeFi platform, not a per-experiment switcher.
Every product reads live from Sepolia; your wallet signs every write.

| Page          | Route          | Built on                                                    |
| ------------- | -------------- | ----------------------------------------------------------- |
| Overview      | `#/overview`   | All products: live liquidity, terms, your positions         |
| Swap          | `#/swap`       | Exp 6 Router (best route, multi-hop, slippage, deadline) + Exp 4 classic pool |
| Pools         | `#/pools`      | Exp 6 pairs + Exp 4 pool: add / remove liquidity, create pairs |
| Earn          | `#/earn`       | Exp 3 ERC-4626 USDC vault, Exp 1 ETH vault, Exp 5 farm + staking (live-ticking rewards) |
| Portfolio     | `#/portfolio`  | Wallet balances + every open position, valued in underlying tokens |
| Faucet        | `#/faucet`     | Public mint for DXA/DXB/DXC; owner-only mint (and reward-pool funding) for the Ownable mocks |
| Activity      | `#/activity`   | Transactions sent from this browser, with Etherscan links   |
| Labs          | `#/labs`       | The original experiment consoles, unchanged (`#/experiment-N` links still work) |

* **Reads** go through MetaMask when it is on Sepolia, otherwise through a public
  RPC (`VITE_SEPOLIA_RPC_URL`, default publicnode.com) — visitors without a
  wallet still see the markets. The snapshot refreshes every 20 s and after
  every confirmed transaction.
* **Writes** run as flows (approve → action) with a toast that follows each
  step to its receipt. Approvals are for the exact amount.
* There is no price oracle yet (Experiment 7), so nothing is converted to USD.

Code: `frontend/src/platform/` (shell, pages, shared UI), `hooks/useProtocolData.js`
(the snapshot), `platform/registry.js` (tokens, products, navigation).

---

## 1. What VaultWise is

VaultWise is a DeFi treasury / vault management project built across **10 experiments**.
Each experiment adds one layer on top of the previous one:

| #  | Experiment                              | Status              |
| -- | --------------------------------------- | ------------------- |
| 1  | React + Ethers.js DApp                  | ✅ **implemented**   |
| 2  | WalletConnect + MetaMask                | planned             |
| 3  | ERC-4626 Vault                          | ✅ **implemented**   |
| 4  | AMM Liquidity Pool                      | ✅ **implemented**   |
| 5  | Yield Farming + Staking                 | ✅ **implemented**   |
| 6  | DEX Prototype                           | ✅ **implemented**   |
| 7  | Chainlink Price Feed Oracle             | planned             |
| 8  | DAO Voting                              | planned             |
| 9  | Flash Loan Attack + Security Mitigation | planned             |
| 10 | Ethereum / Polygon Testnet Deployment   | planned             |

This repository contains **Experiments 1, 3, 4, 5 and 6**. All are reachable from the same
React app, which has an experiment switcher in the navigation bar.

Each experiment adds exactly one layer and keeps the others separate: Experiment 3
an ERC-20 token and an ERC-4626 vault, Experiment 4 a no-fee AMM liquidity pool,
Experiment 5 a yield farm and a protocol-staking contract (Part D), Experiment 6 a
Factory/Pair/Router DEX with a 0.3 % fee (Part E). There are deliberately still no
DAO, no oracles, no flash loans and no backend.

---

## 2. What Experiment 1 demonstrates

A complete, working end-to-end DApp pipeline:

```
React UI
   ↓
Ethers.js
   ↓
MetaMask
   ↓
Sepolia
   ↓
VaultWise Smart Contract
   ↓
Blockchain State
   ↓
React UI Updated
```

Specifically it shows:

* A Solidity contract (`VaultWiseVault.sol`) that holds ETH per user.
* Wallet connection through MetaMask using `BrowserProvider`.
* **Read** calls (no gas, no popup): wallet balance, my vault balance, total vault.
* **Write** calls (signed, cost gas): `deposit()` and `withdraw(amount)`.
* Live account-change and network-change detection.
* Transaction lifecycle UI: pending → confirmed / failed, with a real tx hash and
  an Etherscan link.
* User-friendly error handling instead of raw provider errors.

### User flow

```
                    VAULTWISE
                        │
                        ▼
                [ Connect Wallet ]
                        │
                        ▼
                    MetaMask
                        │
                        ▼
                  Sepolia Testnet
                        │
                        ▼
                VaultWiseVault.sol
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
         Deposit ETH          Withdraw ETH
             │                     │
             └──────────┬──────────┘
                        ▼
                 Updated Balances
       ┌─────────────────────────────────┐
       │ Wallet Balance                  │
       │ My Vault Balance                │
       │ Total Vault                     │
       └─────────────────────────────────┘
```

---

## 3. Technology stack

| Layer           | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| Smart contract  | Solidity `^0.8.20` (compiled with `0.8.28`)               |
| Contract libs   | OpenZeppelin Contracts **v5** (`ERC20`, `ERC4626`, `Ownable`) |
| Contract tool   | Hardhat 3 (compile + test + deploy) · Remix still supported |
| Frontend        | React 19 + Vite                                            |
| Language        | JavaScript (JSX)                                           |
| Blockchain lib  | Ethers.js **v6**                                           |
| Styling         | Plain CSS                                                  |
| Wallet          | MetaMask                                                   |
| Network         | Sepolia testnet                                            |

Deliberately **not** used: Foundry, Next.js, Wagmi, RainbowKit, Viem, Web3.js,
Redux, Firebase, any backend, any database.

### Why Hardhat was added in Experiment 3

Experiment 1 was deployed entirely from Remix, and Remix still works for both
experiments. Hardhat was added for three reasons that Remix cannot cover:

1. **The ABI is generated, not hand-written.** `scripts/syncAbi.js` copies the
   ABI out of the real compilation artifact into the frontend, so the ABI the
   browser uses always matches the bytecode that was compiled.
2. **The vault can be tested.** Experiment 3 has 48 automated tests covering the
   whole ERC-20 + ERC-4626 lifecycle. Checking share accounting by clicking
   buttons in Remix is not a test.
3. **Deployment is reproducible.** One scripted deployment, in the right order,
   with post-deployment assertions that refuse to report success if the vault is
   wired to the wrong asset.

`frontend/` is still its own independent npm project. Nothing about installing
or running the React app changed.

---

## 4. Project structure

```
VaultWise/
├── contracts/
│   ├── experiment1/
│   │   └── VaultWiseVault.sol       # Exp 1 — the plain-ETH vault (unchanged)
│   ├── experiment3/
│   │   ├── MockUSDC.sol             # Exp 3 — ERC-20 underlying asset, 6 decimals
│   │   └── VaultWiseVault.sol       # Exp 3 — ERC-4626 tokenized vault
│   ├── experiment4/
│   │   ├── MockERC20.sol            # Exp 4 — test token, deployed twice (TKA, TKB)
│   │   └── SimpleAMM.sol            # Exp 4 — no-fee x*y=k pool, LP shares = vwLP
│   ├── experiment5/
│   │   ├── SimpleYieldFarm.sol      # Exp 5 Part 1 — stake LPT, harvest RWD
│   │   └── SimpleStaking.sol        # Exp 5 Part 2 — stake ABC, claim RWD
│   │                                #   (both reuse experiment4/MockERC20.sol for LPT/ABC/RWD)
│   ├── experiment6/
│   │   ├── DexMockERC20.sol         # Exp 6 — the sheet's MockERC20: public mint (DXA/DXB/DXC)
│   │   ├── Pair.sol                 # Exp 6 — pool + AMM + LP ERC-20; mint/burn/swap
│   │   ├── Factory.sol              # Exp 6 — createPair (CREATE2), getPair, allPairs
│   │   ├── Router.sol               # Exp 6 — liquidity, multi-hop swaps, quotes
│   │   └── LPFarm.sol               # Exp 6 optional — stake LP, accRewardPerShare rewards
│   └── mocks/
│       ├── ReentrantERC20.sol       # TEST FIXTURE ONLY — hostile token for reentrancy test
│       └── HostileERC20.sol         # TEST FIXTURE ONLY — re-entering / fee / return-false token
│
├── test/
│   ├── experiment3.test.js          # 48 tests over the full ERC-4626 lifecycle
│   ├── experiment4.test.js          # 47 contract tests incl. Sepolia-failure replay
│   ├── experiment4.frontend.test.js # 18 tests of the browser's swap checks & tx states
│   ├── experiment5.test.js          # 74 contract tests, run against both Exp 5 contracts
│   ├── experiment5.frontend.test.js # 10 tests of reward projection & revert explanations
│   ├── experiment6.test.js          # 49 DEX tests: the sheet's 10 scenarios + edge cases + LPFarm
│   └── experiment6.frontend.test.js # 10 tests of quotes, routes, previews & revert explanations
│
├── scripts/
│   ├── deployExperiment3.js         # MockUSDC -> mint -> vault, with assertions
│   ├── experiment3Lifecycle.js      # prints experiment Steps 1-12 end to end
│   ├── deployExperiment4.js         # TKA -> TKB -> mint -> SimpleAMM, with assertions
│   ├── experiment4Lifecycle.js      # prints the 13-step AMM workflow end to end
│   ├── verifyExperiment4.js         # read-only Sepolia diagnosis (npm run verify:exp4)
│   ├── deployExperiment5.js         # LPT/RWD/farm + ABC/RWD/staking, mint + fund, with assertions
│   ├── experiment5Lifecycle.js      # prints both parts' 13-step sequences end to end
│   ├── deployExperiment6.js         # DXA/DXB/DXC -> Factory -> Router -> mint, with assertions
│   ├── experiment6Lifecycle.js      # runs the sheet's 10 DEX scenarios with console output
│   └── syncAbi.js                   # artifacts -> frontend ABI module
│
├── hardhat.config.js                # solc 0.8.28, Sepolia via encrypted keystore
├── package.json                     # contracts workspace (separate from frontend)
│
├── frontend/
│   ├── index.html
│   ├── package.json                 # the React app — its own npm project
│   ├── vite.config.js
│   ├── .env.example                 # copy to .env.local for your addresses
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                  # shell: wallet + experiment switcher only
│       ├── index.css                # one design system for both experiments
│       │
│       ├── hooks/
│       │   ├── useWallet.js         # MetaMask connect / account / chain events
│       │   └── useTransaction.js    # tx lifecycle + decoded event logs
│       │
│       ├── contracts/
│       │   ├── contractConfig.js    # ⭐ every address + network, one file
│       │   └── abis.generated.js    # GENERATED from artifacts — do not edit
│       │
│       ├── components/              # shared: Navbar, Banner, StatCard,
│       │   └── ...                  #         TransactionStatus, Footer
│       │
│       ├── experiments/
│       │   ├── experiment1/         # ETH vault view + its three cards
│       │   │   └── ...
│       │   ├── experiment3/         # ERC-4626 view
│       │   │   ├── Erc4626View.jsx      # reads, writes, wiring
│       │   │   ├── VaultProfileCard.jsx # the VaultWise-specific feature
│       │   │   ├── Erc4626Stats.jsx     # assets / shares / your position
│       │   │   ├── AssetWalletCard.jsx  # USDC balance, allowance, faucet
│       │   │   ├── DepositPanel.jsx     # deposit() and mint()
│       │   │   ├── WithdrawPanel.jsx    # withdraw() and redeem()
│       │   │   ├── ConversionPanel.jsx  # convertToShares / convertToAssets
│       │   │   └── contracts.js         # read/write contract instances
│       │   └── experiment4/         # AMM liquidity pool view
│       │       ├── AmmView.jsx          # reads, writes, wiring check
│       │       ├── PoolStats.jsx        # reserves, LP supply, your share, ratio
│       │       ├── PoolWalletCard.jsx   # TKA/TKB balances, allowances, faucet
│       │       ├── AddLiquidityPanel.jsx    # approve A, approve B, addLiquidity
│       │       ├── SwapPanel.jsx        # both directions, getAmountOut quote
│       │       ├── RemoveLiquidityPanel.jsx # removeLiquidity + estimate
│       │       ├── ammMath.js           # BigInt mirrors of the LP formulas
│       │       └── contracts.js         # read/write contract instances
│       │   └── experiment5/         # yield farming + staking view
│       │       ├── StakingView.jsx      # Part 1 / Part 2 switch, comparison table
│       │       ├── PoolDashboard.jsx    # reads, writes, wiring check (one part)
│       │       ├── PositionStats.jsx    # stake, earned(), projected reward, funding
│       │       ├── StakeWalletCard.jsx  # balances, allowance, mint + fund (owner)
│       │       ├── StakePanel.jsx       # approve -> stake
│       │       ├── WithdrawPanel.jsx    # withdraw() / unstake() (partial)
│       │       ├── RewardPanel.jsx      # harvest() / claimReward() and exit()
│       │       ├── SessionLog.jsx       # confirmed txs with amounts from events
│       │       ├── rewardMath.js        # BigInt mirror of the reward formula
│       │       └── pools.js             # per-part names, addresses, contracts
│       │   └── experiment6/         # DEX view
│       │       ├── DexView.jsx          # reads, writes, wiring check, results
│       │       ├── DexPoolsPanel.jsx    # all three pools: reserves, k, LP, create pair
│       │       ├── DexWalletCard.jsx    # balances, Router allowances, public faucet
│       │       ├── DexSwapPanel.jsx     # routes (direct / multi-hop), min out, deadline
│       │       ├── DexLiquidityPanel.jsx# add (ratio-preserving) / remove liquidity
│       │       ├── dexMath.js           # BigInt mirror of the Router's formulas
│       │       └── dex.js               # contract instances, pair keys, log sources
│       │
│       └── utils/
│           ├── errors.js            # raw errors -> friendly messages
│           └── format.js            # decimal-safe parse/format (6 vs 18)
│
├── .gitignore
└── README.md
```

### Where the ethers.js architecture lives

Both paths are implemented in `frontend/src/App.jsx` and kept visibly separate:

```js
// READ  — React → BrowserProvider → Contract → Blockchain
const getReadContract = (provider) =>
  new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

// WRITE — React → BrowserProvider → Signer → MetaMask → Contract → Blockchain
const getWriteContract = async (provider) => {
  const signer = await provider.getSigner();
  return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
};
```

---

## 5. Install dependencies

Requires **Node.js 22+** (tested on Node 24).

There are two independent npm projects. The React app does not depend on the
contracts workspace, so you can install only what you need.

**The React app** — needed to run the UI:

```bash
cd frontend
npm install
```

**The contracts workspace** — needed to compile, test or deploy contracts:

```bash
# from the repository root
npm install
```

## 6. Run the React frontend

```bash
cd frontend
npm run dev
```

Then open the URL it prints — normally <http://localhost:5173>.

Other frontend commands:

```bash
npm run build     # production build into frontend/dist
npm run preview   # serve the production build locally
npm run lint      # static checks
```

Contract commands, run from the **repository root**:

```bash
npm run compile          # compile everything in contracts/
npm test                 # run the 48 Experiment 3 tests
npm run demo             # print the Experiment 3 lifecycle, Steps 1-12
npm run sync-abi         # regenerate the frontend ABI from the artifacts
npm run deploy:sepolia   # deploy Experiment 3 to Sepolia (needs a funded key)
npm run verify:sepolia   # check the deployed contracts match frontend config
```

> The app runs before you deploy anything, but it will show an orange banner
> saying the contract address is not set, and Deposit/Withdraw stay disabled.

---

# Part A — Experiment 1: React + Ethers.js ETH Vault

> Sections 7 to 15 describe Experiment 1. Experiment 3 starts at Part B.

## 7. Deploy the Experiment 1 contract using Remix

1. Open <https://remix.ethereum.org>.
2. In the **File Explorer**, create a new file named `VaultWiseVault.sol`.
3. Copy the entire contents of `contracts/experiment1/VaultWiseVault.sol` from this repo and
   paste it into that file.
4. Go to the **Solidity Compiler** tab (left sidebar).
   * Compiler version: **0.8.20 or newer** (e.g. `0.8.26`).
   * Click **Compile VaultWiseVault.sol**. You should get a green tick and no
     errors or warnings.
5. Go to the **Deploy & Run Transactions** tab.
   * **To test with no real network first:** set ENVIRONMENT to
     `Remix VM (Cancun)`, click **Deploy**, and play with the buttons that
     appear. This costs nothing and needs no wallet.
   * **To deploy for the DApp:** set ENVIRONMENT to
     **`Injected Provider - MetaMask`**.
6. MetaMask opens — approve the connection. Confirm the Remix ACCOUNT field now
   shows your address, and that MetaMask is on **Sepolia**.
7. Make sure the contract selected in the CONTRACT dropdown is `VaultWiseVault`.
8. Click the orange **Deploy** button.
9. Confirm the transaction in MetaMask and wait for it to be mined.

You need a small amount of Sepolia ETH for gas — see §12.

## 8. How to obtain the contract address

After deploying, look at the **Deployed Contracts** section at the bottom left of
the Deploy tab:

```
▼ VAULTWISEVAULT AT 0X3F2A...9C1B  (blockchain)
```

Click the **copy icon** next to it. That is your `CONTRACT_ADDRESS`.

> This repo does **not** ship a deployed address — nothing has been deployed for
> you. You must deploy it yourself and paste your own address.

## 9. How to obtain the ABI

**You normally never touch the ABI.** Every ABI the frontend uses lives in
`frontend/src/contracts/abis.generated.js`, which is generated from the real
Hardhat compilation artifacts — so it always matches the bytecode that was
compiled. It is marked do-not-edit for that reason.

If you change any `.sol` file, regenerate it from the repository root:

```bash
npm run compile
npm run sync-abi
```

That rewrites `abis.generated.js` with the ABIs of all three contracts
(Experiment 1's ETH vault, MockUSDC, and the ERC-4626 vault) and prints how many
functions and events each one has.

<details>
<summary>Doing it by hand from Remix instead</summary>

1. Remix → **Solidity Compiler** tab → compile the file.
2. At the bottom of that tab, click the **ABI** copy button.
3. Paste the copied JSON array as the matching export in
   `frontend/src/contracts/abis.generated.js`.

This is the fallback for a Remix-only workflow. Prefer `npm run sync-abi`: a
hand-copied ABI can silently drift from the deployed bytecode, and a mismatched
ABI fails in confusing ways at call time rather than at build time.

</details>

## 10. Where to put the address and ABI

Everything lives in exactly one file:

```
frontend/src/contracts/contractConfig.js
```

**Option A — environment file (recommended, nothing to edit in code):**

```bash
cd frontend
cp .env.example .env.local
```

Then set the address for whichever experiment you deployed:

```
# Experiment 1
VITE_CONTRACT_ADDRESS=0xYourDeployedAddressHere

# Experiment 3
VITE_USDC_ADDRESS=0xYourMockUsdcAddressHere
VITE_VAULT4626_ADDRESS=0xYourVaultAddressHere
```

Restart `npm run dev` afterwards — Vite only reads env files at startup.

An experiment whose addresses are missing shows a warning banner and keeps its
buttons disabled, rather than pointing at a wrong contract.

**Option B — edit the file directly:**

```js
export const CONTRACT_ADDRESS = "0xYourDeployedAddressHere";
```

If you regenerated the ABI, paste the copied JSON array as the value of
`CONTRACT_ABI` in the same file:

```js
export const CONTRACT_ABI = [ /* paste here */ ];
```

No React component contains the address or ABI — they only import from this file.

---

## 11. How to connect MetaMask

1. Install the MetaMask extension from <https://metamask.io> and create a wallet.
2. Start the app (`npm run dev`) and open it in the **same browser profile**.
3. Click **Connect Wallet** in the navbar.
4. MetaMask pops up → select the account → **Connect**.
5. The navbar now shows a shortened address such as `0x71A0...92A4` and a
   network pill.

The app remembers the approval: on later visits it reconnects silently using
`eth_accounts` (which never opens a popup). It also reacts live when you switch
account or network inside MetaMask.

## 12. How to use Sepolia

1. Open MetaMask → network dropdown (top left) → select **Sepolia**.
   * If Sepolia is hidden: Settings → Advanced → enable **Show test networks**.
2. Get free test ETH from a Sepolia faucet, for example:
   * <https://sepoliafaucet.com>
   * <https://www.alchemy.com/faucets/ethereum-sepolia>
   * <https://faucet.quicknode.com/ethereum/sepolia>
   A fraction of an ETH is plenty.
3. If you are on any other network, VaultWise shows:
   `Please switch MetaMask to Sepolia Testnet.` and disables the buttons.
   The app never switches networks for you.

## 13. How to test a deposit

1. Connect the wallet, on Sepolia, with the contract address configured.
2. In the **Deposit ETH** card, type `0.01`.
3. Click **Deposit**.
4. MetaMask opens → **Confirm**.
5. Status shows `Transaction pending...` and both buttons disable.
6. After ~15 seconds you get `Transaction confirmed ✓`, the tx hash, and an
   Etherscan link.
7. Verify the numbers:
   * **Wallet Balance** dropped by 0.01 plus gas.
   * **My Vault Balance** rose by 0.01.
   * **Total Vault** rose by 0.01.

## 14. How to test a withdrawal

1. In the **Withdraw ETH** card, type an amount you have deposited — or click
   **Max** to fill your exact vault balance.
2. Click **Withdraw** and confirm in MetaMask.
3. On confirmation, Wallet Balance goes up (minus gas), and My Vault Balance and
   Total Vault go down by the same amount.
4. Try typing more than you deposited: the app blocks it before MetaMask opens,
   and the contract would also reject it with `Insufficient vault balance`.

Cross-check anything on <https://sepolia.etherscan.io> by pasting the tx hash or
the contract address.

---

## 15. Common errors and solutions

| Message you see                                                | Cause                                             | Fix                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `MetaMask was not detected.`                                   | Extension missing, disabled, or wrong browser profile | Install MetaMask, then reload the page                                                       |
| `Contract address not set.` (orange banner)                    | `CONTRACT_ADDRESS` is still the placeholder       | Deploy in Remix, then follow §10. Restart `npm run dev` if you used `.env.local`              |
| `Please switch MetaMask to Sepolia Testnet.`                   | Wrong network selected                            | Switch to Sepolia in MetaMask (§12)                                                          |
| `You rejected the request in MetaMask.`                        | You clicked Reject                                | Retry and click Confirm                                                                      |
| `MetaMask already has a pending request.`                      | An earlier popup is still open                    | Open the MetaMask extension and finish or dismiss it                                         |
| `Not enough ETH in your wallet…`                               | Balance too low for amount + gas                  | Get more Sepolia ETH from a faucet; leave headroom for gas                                   |
| `You cannot withdraw more than you deposited.`                 | Amount exceeds your vault balance                 | Use the **Max** button                                                                       |
| `Could not read the contract…`                                 | Wrong address, wrong network, or wrong ABI        | Confirm the address matches the deployment and that you are on Sepolia                       |
| All values show `0.0000` after connecting                      | Contract not configured, or wrong network         | Same as above                                                                                |
| Deposit reverts with `Use deposit() to add ETH`                | ETH was sent straight to the contract             | Always use the Deposit card — plain transfers are rejected on purpose so accounting stays correct |
| Balances look stale                                            | A tx confirmed on the node but the UI hasn't refetched | Switch account/network back and forth, or reload the page                                |

Full technical details for every error are still printed to the browser console
(`F12` → Console), prefixed with `[VaultWise]`.

---

# Part B — Experiment 3: ERC-4626 Tokenized Vault

**Deploying and Interacting with ERC-4626 Vault Contracts**

## 16. What Experiment 3 adds, and why

Experiment 1's vault held ETH and recorded who owned what in a hand-written
mapping:

```solidity
mapping(address => uint256) public deposits;
```

That works, but the position it creates is invisible to everything else on
chain. You cannot transfer it, you cannot use it as collateral, and no other
protocol can read it. Experiment 3 replaces that mapping with **shares** — and
the shares are themselves an ERC-20 token.

```text
User Wallet
    |
    | holds
    v
ERC-20 MockUSDC
    |
    | approve()
    v
ERC-4626 VaultWise Vault
    |
    | Vault Shares (vwUSDC)
    v
User
```

### Why an ERC-20 is used

ERC-4626 is a standard for *tokenized vaults*, and a tokenized vault is defined
entirely in terms of an underlying **ERC-20** asset. ETH is not an ERC-20 token:
it has no `approve()`, no `allowance()`, no `transferFrom()`. A vault therefore
cannot pull ETH the way ERC-4626 requires, so Experiment 3 introduces a real
ERC-20 token first and builds the vault on that.

### Why ERC-4626 is used

Before ERC-4626, every yield vault invented its own deposit/withdraw interface
and its own share maths, and integrating two of them meant writing two adapters.
ERC-4626 standardises the whole surface — `deposit`, `mint`, `withdraw`,
`redeem`, the four `preview*` quotes, the four `max*` limits, and the two
`convert*` rate functions — so any wallet, aggregator or protocol can use any
vault without special-casing it.

It also removes an entire class of bug: the share accounting is written once, in
an audited library, instead of once per project.

### What the underlying asset is

`MockUSDC` — an ERC-20 token deployed by this project as the vault's underlying
asset.

| Property | Value |
| -------- | ----- |
| Name     | `Mock USDC` |
| Symbol   | `USDC` |
| Decimals | **6** |
| Mint     | `mint(address,uint256)`, restricted to the deployer (`Ownable`) |

It is testnet scaffolding with no value whatsoever. `mint()` is owner-only on
purpose: an unrestricted public mint would make every number in the vault
meaningless.

### What vault shares represent

Depositing mints **`vwUSDC`** — "VaultWise Vault Share" — to you. A share is not
a receipt for a fixed number of tokens. It is a **proportional claim on
everything the vault holds**:

```text
your assets = totalAssets() x (your shares / totalSupply())
```

If the vault ever gains assets without minting new shares, every existing share
is instantly worth more. Nobody's balance changes; the *value* of each share
does. That single property is what later experiments will build yield on top of.

Because the shares are a normal ERC-20, they can be transferred, approved and
spent by `transferFrom` like any other token — and whoever holds them can redeem
them. They are deliberately **not** soulbound; a share that cannot move is not an
ERC-4626 share.

### Why approval is required

The vault does not wait to be sent tokens. It **pulls** them, by calling
`transferFrom(you, vault, amount)` on MockUSDC — and an ERC-20 refuses that
unless you have already granted an allowance.

So depositing is genuinely two transactions, on two different contracts:

```text
1.  MockUSDC.approve(vault, amount)   <- you allow the vault to pull
2.  vault.deposit(amount, you)        <- the vault pulls, and mints your shares
```

The UI shows both as numbered steps, and shows the live
`allowance(you, vault)` so the state between them is never a mystery. Skipping
step 1 fails with `ERC20InsufficientAllowance`, which the app translates into
plain English.

### deposit() vs mint()

Both put assets in and give shares out. They differ in **which side you fix**:

| Function | You specify | The vault derives | Use when |
| -------- | ----------- | ----------------- | -------- |
| `deposit(assets, receiver)` | the **assets** going in | how many shares that buys | "I want to deposit 100 USDC" |
| `mint(shares, receiver)`    | the **shares** coming out | how many assets that costs | "I want exactly 50 shares" |

Quote them first with `previewDeposit(assets)` and `previewMint(shares)`.

### withdraw() vs redeem()

The mirror image, and the same distinction:

| Function | You specify | The vault derives | Use when |
| -------- | ----------- | ----------------- | -------- |
| `withdraw(assets, receiver, owner)` | the **assets** you want back | how many shares to burn | "I want 30 USDC out" |
| `redeem(shares, receiver, owner)`   | the **shares** to burn | how many assets to send | "I want to close 20 shares" |

Quote them with `previewWithdraw(assets)` and `previewRedeem(shares)`.

Neither needs an approval: you are burning your own shares, so the vault has
nothing to pull from you.

With no yield attached the two look identical, which is exactly why the UI shows
them side by side — the difference only becomes visible once a share is worth
more than one asset, and the interface has to already be correct by then.

### What totalAssets() means

`totalAssets()` is the total amount of the **underlying asset** the vault
controls, denominated in that asset — here, how much USDC the vault holds. It is
the numerator of the share price.

Do not confuse it with `totalSupply()`, which counts **shares**. The pair is the
whole accounting model:

```text
totalAssets()  = 100 USDC     <- what the vault holds
totalSupply()  = 100 vwUSDC   <- claims outstanding against it
                                 => 1 share is worth 1 USDC
```

### What convertToShares() and convertToAssets() do

They are the vault's exchange rate, in both directions, as free view calls:

* `convertToShares(assets)` — what N assets are worth in shares
* `convertToAssets(shares)` — what N shares are worth in assets

They express the *ideal* rate, ignoring rounding and fees, which makes them the
right functions for displaying a price. For an actual transaction, use the
`preview*` functions instead: those include exactly the rounding the vault will
apply, so what they quote is what you get.

While the vault holds no yield the rate is 1:1. The test suite proves it moves
correctly when it should: donate 100 USDC to a vault holding 100 USDC and 100
shares, and each share is then worth ~2 USDC while nobody's balance changed.

### What the VaultWise-specific feature does

**`vaultProfile()`** — a read-only function returning this vault's VaultWise
identity together with its live token details:

```solidity
struct Profile {
    string  label;         // "VaultWise Core USDC Vault"
    string  category;      // "Stablecoin Treasury"
    string  riskNote;      // plain-language risk statement
    string  experiment;    // "Experiment 3 - ERC-4626 Tokenized Vault"
    address assetAddress;  // read live from asset()
    string  assetSymbol;   // "USDC"
    string  shareSymbol;   // "vwUSDC"
    uint8   assetDecimals; // 6
    uint8   shareDecimals; // 6
}
```

**Why it is application-specific rather than generic ERC-4626 boilerplate:**
VaultWise is a multi-vault product. Later experiments add more vaults with
different assets and different mandates, and the React frontend has no backend
and no database to describe them with. Without on-chain metadata the UI could
only ever show an address. With it, the vault describes itself — and the
description lives next to the vault it describes, so it cannot drift out of sync
the way a hardcoded label in a frontend bundle would.

**Why it is safe:** the metadata is `constant`, so it writes no storage after
deployment. No ERC-4626 function reads it. Nothing is overridden. The
asset/share accounting is byte-for-byte the standard's behaviour with or without
the feature, and a test asserts exactly that.

---

## 17. Deploy Experiment 3

Two contracts must be deployed, **in this order** — the vault takes the token's
address as its only constructor argument, so the token must exist first.

```text
1. Deploy MockUSDC
2. Mint MockUSDC to your test wallet
3. Deploy VaultWiseVault(MockUSDC address)
4. Put both addresses in frontend/.env.local
```

> Experiment 1's deployed vault at `0x172b07bab2415A7EF32eA150c499CFB9B6cc236a`
> is **not** the ERC-4626 vault and must not be used as one. It is a different
> contract with a different ABI, still live and still reachable from the
> Experiment 1 tab.

### Option A — Hardhat (scripted, recommended)

Store the two secrets in Hardhat's encrypted keystore. They never touch this
repository:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL      # e.g. an Alchemy or Infura URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY  # a TEST key with Sepolia ETH only
```

Then, from the repository root:

```bash
npm run compile
npm test                 # do not deploy code that does not pass
npm run deploy:sepolia
```

The script deploys, mints 1000 USDC, deploys the vault, and then **verifies**
before reporting success — it asserts that `asset()` really points at the
MockUSDC it just deployed and that the fresh vault is empty. It writes
`deployments/sepolia.json` and prints the two lines to paste into
`frontend/.env.local`.

> **Never use a private key that holds real funds.** Create a throwaway wallet,
> fund it from a Sepolia faucet, and use only that.

### Option B — Remix (same workflow as Experiment 1)

1. Open <https://remix.ethereum.org>.
2. Create `MockUSDC.sol` and paste in `contracts/experiment3/MockUSDC.sol`.
   Remix resolves the `@openzeppelin/contracts/...` imports from npm on its own.
3. Compile with **0.8.20 or newer**.
4. Deploy tab → ENVIRONMENT **`Injected Provider - MetaMask`**, on **Sepolia**.
5. Deploy `MockUSDC` (it takes no constructor arguments). Copy its address.
6. On the deployed MockUSDC, call `mint` with:
   * `to` — your wallet address
   * `amount` — `1000000000` (that is 1000 USDC at 6 decimals, **not** `1000`)
7. Create `VaultWiseVault.sol` and paste in
   `contracts/experiment3/VaultWiseVault.sol`. Compile it.
8. Deploy `VaultWiseVault`, passing the **MockUSDC address** as `asset_`.
9. Copy the vault address.
10. Put both addresses in `frontend/.env.local` and restart `npm run dev`.

### Deployed Sepolia addresses

| Contract | Address | Explorer |
| -------- | ------- | -------- |
| Experiment 1 — `VaultWiseVault` (ETH vault) | `0x172b07bab2415A7EF32eA150c499CFB9B6cc236a` | [view](https://sepolia.etherscan.io/address/0x172b07bab2415A7EF32eA150c499CFB9B6cc236a) |
| Experiment 3 — `MockUSDC` (ERC-20 asset) | `0x85016FBbE60423B5aB92B6b9d9646FCAA51628e5` | [view](https://sepolia.etherscan.io/address/0x85016FBbE60423B5aB92B6b9d9646FCAA51628e5) |
| Experiment 3 — `VaultWiseVault` (ERC-4626) | `0x4fc3c56482DC1a4c9411A7C5890702284Af6e070` | [view](https://sepolia.etherscan.io/address/0x4fc3c56482DC1a4c9411A7C5890702284Af6e070) |

The vault's `asset()` returns the MockUSDC address above — verified on-chain, not
assumed. Add your deployment transaction hashes here as a record; a scripted
deployment also writes them to `deployments/sepolia.json`.

### Check a deployment against the frontend config

```bash
npm run verify:sepolia
```

Reads the addresses out of `frontend/.env.local` (or `frontend/.env`), queries a
public Sepolia RPC, and confirms there is real bytecode at each address, that
MockUSDC has 6 decimals, that the share token is `vwUSDC`, that the vault's
`asset()` points at the configured MockUSDC, and that the ERC-4626 surface and
`vaultProfile()` answer correctly. Needs no private key and no keystore. It exits
non-zero on any mismatch, so it is the fastest way to diagnose an app showing
unexpected numbers.

---

## 18. Run the experiment lifecycle

`npm run demo` walks the whole experiment end to end and prints every value —
addresses, transaction hashes, balances, previews, conversions, and the decoded
event logs. It deploys its own fresh contracts so the numbers always start from
a known state:

```bash
npm run demo                                              # local, free, instant
npx hardhat run scripts/experiment3Lifecycle.js --network sepolia   # real, costs gas
```

The twelve steps it covers:

| Step | What it does | What to look for |
| ---- | ------------ | ---------------- |
| 1 | Deploy `MockUSDC` | address + tx hash, 6 decimals |
| 2 | Mint 1000 USDC | `balanceOf(user)` = `1000000000` base units |
| 3 | Deploy `VaultWiseVault(MockUSDC)` | address + tx hash, share symbol `vwUSDC` |
| 4 | `asset()` and `totalAssets()` | asset matches MockUSDC; assets start at 0 |
| 5 | `approve(vault, 100 USDC)` | `allowance(user, vault)` = 100 USDC |
| 6 | `previewDeposit` / `convertToShares` | both quote 100 vwUSDC |
| 7 | `deposit(100 USDC, user)` | USDC down, shares up, totals up |
| 8 | `convertToShares` / `convertToAssets` | the rate, in both directions |
| 9 | `mint(50 vwUSDC)` | shares fixed, cost derived |
| 10 | `withdraw(30 USDC)` | assets fixed, shares burned derived |
| 11 | `redeem(20 vwUSDC)` | shares fixed, assets returned derived |
| 12 | Event summary | which standard emitted what |

### The events, and which standard owns them

Step 12 is worth reading closely. A single `deposit()` emits **three** events
across **two** contracts:

```text
[MockUSDC]       Transfer(from=user,  to=vault, value=100000000)   ERC-20
[VaultWiseVault] Transfer(from=0x0,   to=user,  value=100000000)   ERC-20  (shares minted)
[VaultWiseVault] Deposit(sender=user, owner=user, assets=…, shares=…)  ERC-4626
```

and `withdraw()` / `redeem()` mirror it:

```text
[VaultWiseVault] Transfer(from=user, to=0x0,  value=…)   ERC-20  (shares burned)
[MockUSDC]       Transfer(from=vault, to=user, value=…)  ERC-20
[VaultWiseVault] Withdraw(sender, receiver, owner, assets, shares)  ERC-4626
```

Note that MockUSDC and the vault emit **byte-identical** `Transfer` signatures —
the vault's shares are an ERC-20 too. Logs must therefore be attributed by the
**emitting contract address**, never by matching the event signature against
each ABI in turn, or a share mint gets reported as a token transfer. Both the
demo script and the frontend do it by address.

The frontend decodes the same events from the receipt and shows them under the
transaction status, tagged `ERC-20` or `ERC-4626`.

---

## 19. Tests

```bash
npm test
```

48 tests in `test/experiment3.test.js`, covering every point the experiment
requires:

| # | Covered | # | Covered |
| - | ------- | - | ------- |
| 1 | MockUSDC deployment | 10 | `totalAssets()` after deposit |
| 2 | MockUSDC mint | 11 | `totalSupply()` after deposit |
| 3 | Vault deployment | 12 | `convertToShares()` |
| 4 | `asset()` | 13 | `convertToAssets()` |
| 5 | Initial `totalAssets()` | 14 | `mint()` |
| 6 | ERC-20 approval | 15 | `withdraw()` |
| 7 | `allowance()` | 16 | `redeem()` |
| 8 | `deposit()` | 17 | Underlying assets returned |
| 9 | Vault shares received | 18 | ERC-20 + ERC-4626 events |

Plus the `max*` limit functions, the ERC-20 behaviour of the shares themselves
(transfer, approve, allowance, transferFrom, and that a transferred share
carries its claim with it), and the vault-profile feature — including an
assertion that it does not perturb share accounting.

The most interesting test is the re-pricing one: donate 100 USDC to a vault
holding 100 USDC against 100 shares, and each share becomes worth ~2 USDC with
no balance changing. That is the mechanism every later yield experiment depends
on, proven here in isolation.

---

## 20. Decimals

MockUSDC uses **6 decimals**, matching real USDC, rather than the usual 18. This
is the correctness trap the experiment is designed to expose.

```text
100 USDC  ==  100000000 base units      (100 x 10^6)
NOT       ==  100 base units            (which is 0.0001 USDC)
```

**In Solidity:** OpenZeppelin v5's `ERC4626` reads `decimals()` from the
underlying asset in its constructor and derives the share decimals from it, so
`vwUSDC` is also 6 decimals. No override and no workaround is needed — using 6
decimals caused no compatibility issue at all, so the standards-compliant
approach was simply kept.

OpenZeppelin v5 also defends against the classic share-inflation ("donation")
attack with virtual assets and shares rather than custom code, which is why an
empty vault still converts 1 asset to exactly 1 share and the numbers in this
experiment stay readable.

**In the frontend:** `parseEther` / `formatEther` are hardcoded to 18 decimals
and are therefore *wrong* here — `parseEther("100")` would request 10^12 times
too much USDC. Every amount goes through `frontend/src/utils/format.js`, which
takes the decimals explicitly:

```js
parseAmount("100", 6).value   // 100000000n
formatAmount(100000000n, 6)   // "100.00"
```

The app **reads the decimals from the contracts at runtime** rather than
assuming 6, so nothing breaks if the underlying asset is ever swapped for an
18-decimal token. `parseAmount` also rejects more decimal places than the token
supports (`0.0000001` on a 6-decimal token) instead of letting `parseUnits`
throw, and `toExactString` backs the **Max** buttons at full precision — the
rounded display value could round *up* and ask for more than you hold.

---

## 21. Using the Experiment 3 UI

Open the app, choose **ERC-4626 Vault** in the navigation bar, and connect
MetaMask on Sepolia.

1. **Vault Profile** — the self-describing card, from `vaultProfile()`.
2. **Vault Statistics** — `totalAssets()`, `totalSupply()`, your share balance,
   and what your shares are currently worth.
3. **Wallet** — your USDC balance, your live allowance to the vault, and a
   **Mint** control for test tokens. That control only works for the wallet that
   deployed MockUSDC, because `mint()` is owner-only.
4. **Conversion** — type into either side to see `convertToShares()` and
   `convertToAssets()` live. Free, no gas, no signature.
5. **Deposit** — two tabs. *Deposit assets* fixes the USDC going in;
   *Mint shares* fixes the shares coming out. Both show the live `preview*`
   quote and both use the numbered **Approve → Deposit** flow.
6. **Withdraw** — two tabs. *Withdraw assets* fixes the USDC coming out;
   *Redeem shares* fixes the shares burned. Max is bounded by `maxWithdraw()`
   and `maxRedeem()` read from the vault.
7. **Transaction Status** — step indicator, real tx hash, Etherscan link, and
   the decoded ERC-20 / ERC-4626 events from the receipt.

### Experiment 3 errors

| Message you see | Cause | Fix |
| --------------- | ----- | --- |
| `Experiment 3 addresses not set.` | `VITE_USDC_ADDRESS` / `VITE_VAULT4626_ADDRESS` missing | Deploy both contracts, set both variables, restart `npm run dev` |
| `The vault is not approved to move that many tokens yet.` | `ERC20InsufficientAllowance` — you skipped Approve | Run step 1 (Approve Vault) for at least the amount you are depositing |
| `You do not have that many tokens in your wallet.` | `ERC20InsufficientBalance` | Mint more test USDC, or deposit less |
| `You cannot withdraw that much…` | `ERC4626ExceededMaxWithdraw` | Use **Max** — it is bounded by `maxWithdraw()` |
| `You cannot redeem that many shares…` | `ERC4626ExceededMaxRedeem` | Use **Max** — it is bounded by `maxRedeem()` |
| `Only the wallet that deployed MockUSDC can mint test tokens.` | `mint()` is owner-only | Switch to the deployer account, or have it mint to you |
| `This token has 6 decimals, so at most 6 digits after the point.` | Too many decimal places typed | Round to 6 decimal places |
| All values show `0.00` after connecting | Wrong addresses, or wrong network | Check both addresses and that MetaMask is on Sepolia |

Full technical detail for every error is still printed to the browser console
(`F12` → Console), prefixed with `[VaultWise]`.

---

# Part C — Experiment 4: AMM Liquidity Pool

## 22. Aim and theory

**Aim.** Build a liquidity pool for two ERC-20 tokens that prices trades with an
automated market maker (AMM), issues LP shares to liquidity providers, and
supports swaps in both directions — and verify its arithmetic exactly.

**Theory.** An order book matches buyers with sellers. An AMM replaces the
counterparty with a pool of both tokens and a pricing rule. VaultWise uses the
**constant-product** rule:

```text
x · y = k        x = reserve of Token A, y = reserve of Token B
```

A trade that adds `Δx` of Token A must leave the product unchanged, so the
pool pays out `Δy = y − k / (x + Δx)` of Token B. The **spot price** `y / x`
is what an infinitesimal trade gets; any real trade moves the reserves and
gets a worse average rate — that difference is **price impact**, and it grows
with trade size relative to the pool. There is **no fee** in this experiment,
so price impact is the only cost of a swap.

**LP shares** represent a claim on a fraction of both reserves. The first
provider sets the price and receives `√(amountA · amountB)` shares; later
providers receive shares in proportion to what they add; burning shares
returns the same proportion of both reserves.

## 23. Architecture

| Contract | Deployed | Responsibility |
| -------- | -------- | -------------- |
| `contracts/experiment4/MockERC20.sol` | twice: `("Token A","TKA")`, `("Token B","TKB")` | 18-decimal test tokens; `mint` is owner-only |
| `contracts/experiment4/SimpleAMM.sol` | once: `(TKA, TKB)` | reserves, liquidity, swaps; is itself the `vwLP` ERC-20 |

`contracts/mocks/ReentrantERC20.sol` is a **test fixture only** (a hostile
token for the reentrancy test). It is never deployed and is not part of the
experiment's two-source deliverable.

```text
wallet ── approve() ──▶ TKA / TKB (ERC-20)
wallet ── addLiquidity / swapAForB / swapBForA / removeLiquidity ──▶ SimpleAMM
SimpleAMM ── transferFrom / transfer ──▶ TKA / TKB      SimpleAMM ── mint/burn ──▶ vwLP
```

**Contract maths (exact, integer):**

| Operation | Formula | Rounding |
| --------- | ------- | -------- |
| First deposit | `shares = √(a · b)` | floor |
| Later deposit | `shares = min(a·S/rA, b·S/rB)` | floor; off-ratio excess stays in the pool |
| Removal | `outX = lp · rX / S` | floor — never pays more than your share |
| Swap A→B | `newB = ⌈rA·rB / (rA + in)⌉`, `out = rB − newB` | output ≤ exact by < 1 base unit, pool-favoured |
| Swap B→A | symmetric | same |

The experiment sheet writes the new reserve with plain (floor) division; the
contract rounds it **up**, so `k` never decreases (`k ≤ k′ < k + newReserveIn`)
and the output differs from the sheet's formula by at most 1 base unit.

**Validation:** custom errors for zero / identical / non-contract token
addresses, zero amounts, insufficient balance and insufficient allowance
(checked explicitly before `transferFrom`), removing more LP than owned, an
empty pool, and outputs that would round to zero. `SafeERC20` on every
transfer; `ReentrancyGuardTransient` on every state-changing function;
checks → effects → interactions.

**`ReentrancyGuardTransient` compatibility.** It uses EIP-1153 transient
storage (`TSTORE`/`TLOAD`). Requirements and status: Solidity ≥ 0.8.24 (repo
uses 0.8.28 ✔), EVM target cancun or later (0.8.28's default ✔), OpenZeppelin
5.x (5.6.1 ✔; the storage-based `ReentrancyGuard` is deprecated there),
network support (Sepolia since Dencun, March 2024 ✔). Empirically, the
deployed pool's `addLiquidity` — which runs the guard — succeeded on Sepolia
(tx `0x38501a1c…`). The guard was kept.

## 24. Verified Sepolia deployment

Verified on **2026-10-15** with `npm run verify:exp4` (read-only):

| Item | Value | Verified |
| ---- | ----- | -------- |
| Network | Sepolia, chain id **11155111** | `eth_chainId` |
| Token A (TKA) | `0x785BD01f7EA2BFD11f7Dfa3e53129b83Ab807138` | bytecode == this repo's `MockERC20` (ignoring metadata); 18 decimals |
| Token B (TKB) | `0xfD6f659d80e0E7aF1bbddA58c33c73C855C2114b` | bytecode == `MockERC20`; 18 decimals |
| SimpleAMM | `0x14bDB27779bC6A8DA677e7674B09105AeFEb6ceb` | bytecode == this repo's `SimpleAMM` (ignoring metadata + immutables); `tokenA()`/`tokenB()` == TKA/TKB |
| AMM deploy block | 11915032 | `eth_getCode` history |
| Token owner | `0xcd1a6B2f01fEddF7520C0Eb3306027a2c6c4c730` | `owner()` on both tokens |

**Confirmed Sepolia transactions** (all receipts `status = 1`; read from the
chain, not supplied by hand):

| Block | Action | Tx hash |
| ----- | ------ | ------- |
| 11914927 | Deploy TKA | `0x52a9b762fb3867abc60b00f471ea384345865723c8c7438ad3783a5d05030288` |
| 11914943 | Deploy TKB | `0x6ce46c27d3b7ae9a7c5c5199d36518d757022e81d3b818182f0891b0357a4ee7` |
| 11915032 | Deploy SimpleAMM | `0x1f522e11638a2fbebe68124223e2f9aa247c89b65b9b5b8e7ea32d7c6858ed31` |
| 11915067 | Mint 100 TKA | `0x83b8573c5ed09d2e5c621b6108f27ade861fb9234f716f13bcb93f282ddabaed` |
| 11915072 | Mint 100 TKB | `0xd0d86172ffdf2023ebce8b4ea30c6a7bb4f90a7ab102778810cefb0099ee8331` |
| 11915099 | Approve 100 TKA | `0x049cb7817f987ae32f23c83bf8a46ce418082a8dce278a197a50a5ac19eab6a7` |
| 11915102 | Approve 100 TKB | `0x9b5acd9a446c1a32891607b9c5df1791f68ed0f4b7290ee6417751881cbb4f37` |
| 11915120 | `addLiquidity(100, 100)` → 100 vwLP | `0x38501a1cb66d1996e34f5367763fdeb2b0f0258487539ff3d4627370f1ad992b` |
| 11915177 | Approve 10 TKA | `0x9d3314905c5a168433d4728b40b9bec0072a9a8bf50073a48334e18016192da4` |
| 11915182 | Approve 10 TKB | `0x8e91753ce0994b10426796c797f95d67230219084796a7a8e5f9a471145794c8` |

**No swap has been confirmed on Sepolia yet.** Add swap hashes here only after
they are mined.

### Root cause of the `InsufficientBalance` swap failure

`swapAForB(5e18)` and `swapAForB(1e18)` reverted with
`InsufficientBalance(TKA, 0, amount)` because **the wallet's TKA balance was
genuinely 0**:

1. The wallet minted exactly **100 TKA** and **100 TKB** (TKA `totalSupply()` is 100).
2. `addLiquidity(100, 100)` moved **all** of it into the pool in exchange for 100 vwLP.
3. It then approved the pool for 10 TKA / 10 TKB. An approval is permission to
   spend — it does not create tokens.
4. `swapAForB` checks `balanceOf(msg.sender)` first; it was 0, so it reverted
   correctly.

The "100 TKA" seen in Remix was not the wallet's current balance. On chain
the wallet held 100 TKA only between blocks 11915067 and 11915120; a
`balanceOf` result Remix displays stays on screen after later transactions,
and `balanceOf(SimpleAMM)` / `reserveA` are also exactly 100.

Ruled out with evidence: wrong network (chain 11155111 ✔); wrong contract or
ABI (bytecode matches this repo ✔); token mis-wiring (`tokenA()` == TKA ✔);
decimals (18 ✔; the revert's required amount was exactly 1e18/5e18 ✔); signer
mismatch — the wallet is a MetaMask **EIP-7702 smart account** whose
transactions were relayed, but `msg.sender` is still the wallet (the
owner-only `mint` succeeded, and `addLiquidity` pulled tokens *from* it);
contract logic — 113 automated tests including an exact replay of this
sequence.

**Fix:** no redeployment is needed. Either mint more TKA/TKB to the wallet
(token owner only — `mint(wallet, amount)`), or `removeLiquidity` some vwLP
first. The UI now runs a pre-swap check that shows the signer's real balance,
allowance and LP shares and explains this case before MetaMask opens; and
`npm run verify:exp4 -- <wallet> 1 AtoB` diagnoses it from the command line.

## 25. Deploying (new deployments only)

The current deployment is verified and needs no redeploy. For a fresh one:

**Remix:** compiler 0.8.28, EVM version default (cancun or later), Injected
Provider on Sepolia. Deploy `MockERC20("Token A","TKA")`, `MockERC20("Token B","TKB")`,
then `SimpleAMM(<TKA>, <TKB>)`.

**Hardhat:**

```bash
npx hardhat keystore set SEPOLIA_RPC_URL       # once; never committed
npx hardhat keystore set SEPOLIA_PRIVATE_KEY   # once; never committed
npm run deploy:exp4:sepolia                    # deploys, mints 10 000 each, verifies wiring
```

Then put the new addresses in `frontend/.env` **only after**
`npm run verify:exp4` passes against them:

```bash
VITE_TOKEN_A_ADDRESS=0x...
VITE_TOKEN_B_ADDRESS=0x...
VITE_AMM_ADDRESS=0x...
VITE_AMM_DEPLOY_BLOCK=...   # optional; speeds up the activity history
```

## 26. Running locally

```bash
npm install && (cd frontend && npm install)   # once
npx hardhat compile && npm run sync-abi       # after any contract change
npm test                                      # 113 tests, in-process chain
npm run demo:exp4                             # 13-step workflow with console output
npm run verify:exp4 -- 0xYourWallet 1 AtoB    # read-only Sepolia diagnosis
cd frontend && npm run dev                    # http://localhost:5173/#/experiment-4
```

## 27. Using MetaMask on Sepolia — step by step

Prerequisites: MetaMask on **Sepolia**, a little Sepolia ETH for gas, and the
token-owner wallet (only it can mint).

1. **Connect.** Open `#/experiment-4`, click *Connect Wallet*. Check the wallet
   card shows your address and *Sepolia Testnet*. On any other network a banner
   offers *Switch to Sepolia* (MetaMask asks you to approve it).
2. **Verify the pool.** *Pool Overview* shows the live reserves (currently
   100 / 100), both spot rates, LP supply, your LP shares, and the block the
   numbers were read at.
3. **Get tokens to trade.** The wallet card shows TKA/TKB balances with their
   decimals. If it says *0 in wallet — your TKA is in the pool*, mint some:
   enter `10`, click *Mint TKA* (and *Mint TKB*), confirm in MetaMask.
4. **TKA → TKB.** In *Swap*, choose *TKA → TKB*, enter `1`. Read the
   **calculated** quote (from `getAmountOut`), price impact, minimum received
   at your tolerance, and fee (none). Click *Check this swap without sending*
   to see the pre-swap report. Click *Approve TKA* if needed, confirm; then
   *Swap*, confirm.
5. **Verify.** The *Last Swap — confirmed* card shows the tx hash (Etherscan
   link), the input and the output from the `Swap` event, reserves before and
   after, your new balances, and the change in `k`. *Pool Activity* lists the
   swap from the event logs.
6. **TKB → TKA.** Repeat with the *TKB → TKA* tab.
7. **Liquidity (optional).** *Add Liquidity*: enter TKA (TKB auto-fills at the
   pool ratio), Approve TKA → Approve TKB → Add. *Remove Liquidity*: enter vwLP
   or Max → Remove.

### Expected values (hypothetical — not evidence)

For the **current** 100 / 100 pool, the contract's integer maths gives (these
are calculations, verified by `npm test`, not Sepolia results):

| Swap | Output | Reserves after |
| ---- | ------ | -------------- |
| 1 TKA → TKB | 0.990099009900990099 TKB | 101 TKA / 99.009900990099009901 TKB |
| then 1 TKB → TKA | 1.0099000099000099 TKA | 99.9900999900999901 TKA / 100.009900990099009901 TKB |

The second row assumes nothing else trades in between. The UI never shows
these numbers — it reads the real reserves and receipts.

### Evidence checklist

- [ ] `npm run verify:exp4` output (all PASS)
- [ ] Wallet card: address, Sepolia, TKA/TKB balances and decimals
- [ ] Pool Overview before swapping (reserves, rates, LP, block number)
- [ ] Mint transactions (if needed) — hashes
- [ ] Approval transaction — hash and the updated allowance
- [ ] Swap panel: quote, price impact, minimum received, pre-swap report
- [ ] TKA → TKB: *Last Swap* card (hash, in/out, reserves before/after, k)
- [ ] TKB → TKA: the same
- [ ] Pool Activity table showing both swaps
- [ ] Etherscan page for one swap showing the `Swap` and `Sync` events
- [ ] (optional) Add/remove liquidity with LP balance before and after
- [ ] Observation: how reserves moved, and that `k` never decreased

## 28. Tests

`npm test` runs **113** tests (48 Experiment 3, 65 Experiment 4):

* `test/experiment4.test.js` — deployment and minting, constructor validation,
  first/proportional LP minting, zero amounts, removal and over-removal, both
  swap directions against an independently computed output, empty pool and
  zero-output cases, insufficient allowance/balance, full lifecycle, the `k`
  band, rollback of failed transactions, an **exact replay of the Sepolia
  sequence** (100/100 pool, `InsufficientBalance(TKA, 0, 5e18)`, then the 1-TKA
  swap giving 0.990099009900990099), reverse and repeated swaps, and
  **reentrancy** through a hostile token.
* `test/experiment4.frontend.test.js` — the browser's pre-swap checks (wrong
  chain, signer ≠ page account, token mis-wiring, empty pool, balance,
  allowance, the LP-deposit explanation), transaction state transitions
  (awaiting signature, submitted, confirmed, reverted, rejected), error
  messages, price impact / minimum-received / rate formatting, and an
  integration test that runs the UI's checks against the reproduced state.

Not automated: React rendering and live MetaMask interaction.

# Part D — Experiment 5: Simulating Yield Farming and Staking Mechanisms

## 29. Aim and theory

**Aim.** Simulate the two most common DeFi reward mechanisms and observe them
on-chain: **yield farming** (Part 1), where an LP-like token is staked to earn
an extra reward token, and **protocol-token staking** (Part 2), where a
protocol's own token is staked to earn rewards — with time-based reward
accrual, harvesting, partial withdrawal and exit, and basic validation.

**Theory.** Both contracts use the experiment sheet's introductory model:

```text
Reward = Staked Amount × Reward Rate × Elapsed Time
Reward Rate = 0.001 RWD per staked token per second
100 tokens × 0.001 × 60 s = 6 RWD
```

The rate is deliberately fast for classroom observation; real protocols use
emission schedules, reward periods, pool weights and lock-ups.

* **Staking** = locking a token in a contract under its rules.
* **Farming rewards** = an additional incentive token paid for staking an LP
  position. In Experiment 4 a provider receives LP shares; here the LP-like
  token **LPT** stands in for that position.
* **AMM trading fees** = the return generated by swaps in the pool itself
  (Experiment 4's pool has no fee).
* **Impermanent loss** = the LP position's underperformance against simply
  holding the two assets when their relative price moves. Staking LPT in the
  farm does **not** create it — it belongs to the AMM position behind the LP
  token. Farming rewards may offset some or all of it; nothing guarantees they
  will. The final outcome depends on fees, reward value, impermanent loss,
  price changes and transaction costs.

| | Part 2 — Protocol staking | Part 1 — Yield farming |
| --- | --- | --- |
| What is staked | the ABC protocol token | an LP token / LP position (LPT) |
| Liquidity pool needed | no | usually follows liquidity provision |
| Why rewards are paid | for locking ABC under protocol rules | as an extra incentive for the LP position |
| Impermanent loss | not inherent to this position | the underlying LP position may suffer it |
| Main flow | ABC → Stake → Reward → Unstake | Provide liquidity → LPT → Farm → Reward |

SimpleStaking is protocol-token staking, **not** Ethereum validator staking or a
Proof-of-Stake consensus implementation. Neither contract contains AMM swaps,
liquidity-pool reserve logic, oracles, governance or flash loans.

## 30. Contract architecture

| Contract | Deployed | Responsibility |
| -------- | -------- | -------------- |
| `contracts/experiment4/MockERC20.sol` | Part 1: `("LP Token","LPT")`, `("Reward Token","RWD")` · Part 2: `("Protocol Token","ABC")`, `("Reward Token","RWD")` | 18-decimal OpenZeppelin ERC-20 with owner-only `mint(to, amount)` |
| `contracts/experiment5/SimpleYieldFarm.sol` | once: `(LPT, RWD)` | stake LPT, accrue RWD, `harvest`, `withdraw`, `exit` |
| `contracts/experiment5/SimpleStaking.sol` | once: `(ABC, RWD)` | stake ABC, accrue RWD, `claimReward`, `unstake`, `exit` |

**Why `MockERC20.sol` is reused, not copied.** It is already exactly the token
the sheet describes (`constructor(name, symbol)`, `mint`, inherited
`balanceOf`/`transfer`/`approve`/`allowance`/`transferFrom`), and it contains no
AMM logic. A second contract also named `MockERC20` would make Hardhat's
`getContractFactory("MockERC20")` ambiguous and break Experiment 4's scripts and
tests. So each part is still "two Solidity sources" — `MockERC20.sol` plus its
reward contract — and the Experiment 4 file is untouched. Each part deploys its
**own** RWD, as the sheet's interaction sequences do.

`contracts/mocks/HostileERC20.sol` is a **test fixture only** (re-entering,
fee-on-transfer and return-`false` behaviours). It is never deployed.

```text
                Part 1                                    Part 2
wallet ─ approve ─▶ LPT                       wallet ─ approve ─▶ ABC
wallet ─ stake / harvest / withdraw / exit ─▶ SimpleYieldFarm      wallet ─ stake / claimReward / unstake / exit ─▶ SimpleStaking
SimpleYieldFarm ─ transferFrom / transfer ─▶ LPT                  SimpleStaking ─ transferFrom / transfer ─▶ ABC
SimpleYieldFarm ─ transfer ─▶ RWD (paid from its own balance)    SimpleStaking ─ transfer ─▶ RWD
RWD owner ─ mint(farm, …) ─▶ RWD  (funding)                       RWD owner ─ mint(staking, …) ─▶ RWD
```

**State (both contracts, as the sheet lists):** `stakingToken`, `rewardToken`
(immutable `IERC20`), `stakedBalance`, `lastUpdate`, `pendingReward`
(`mapping(address => uint256)`), `rewardRate` (`uint256` constant), plus
`totalStaked` and the constant `REWARD_PRECISION`.

| | SimpleYieldFarm (Part 1) | SimpleStaking (Part 2) |
| --- | --- | --- |
| Stake | `stake(amount)` → `Staked(user, amount)` | `stake(amount)` → `Staked(user, amount)` |
| Reward view | `earned(user)` | `earned(user)` |
| Pay reward | `harvest()` → `RewardPaid(user, reward)` | `claimReward()` → `RewardClaimed(user, reward)` |
| Return stake | `withdraw(amount)` → `Withdrawn(user, amount)` | `unstake(amount)` → `Unstaked(user, amount)` |
| Both | `exit()` → `Withdrawn` + `RewardPaid` | `exit()` → `Unstaked` + `RewardClaimed` |
| Extra views | `totalStaked()`, `rewardBalance()` | `totalStaked()`, `rewardBalance()` |

**Validation (custom errors carry the real numbers):**

| Check | Error |
| ----- | ----- |
| zero stake / zero withdrawal | `ZeroAmount()` |
| wallet holds less than the stake | `InsufficientBalance(available, required)` |
| allowance below the stake (checked before `transferFrom`) | `InsufficientAllowance(allowed, required)` |
| withdraw / unstake more than staked | `InsufficientStakedBalance(staked, requested)` |
| contract holds less RWD than the payout | `InsufficientRewardFunding(available, required)` |
| harvest / claim with nothing accrued | `NoRewardToHarvest()` / `NoRewardToClaim()` |
| exit with no stake and no reward | `NothingToExit()` |
| fee-on-transfer staking token | `TransferAmountMismatch(expected, received)` |
| constructor: zero / identical / non-contract / non-18-decimal token | `ZeroAddress`, `IdenticalTokens`, `NotAContract`, `UnsupportedDecimals` |

`SafeERC20` on every transfer, `ReentrancyGuardTransient` on every
state-changing function (same EIP-1153 requirements as Experiment 4, §23), and
checks → effects → interactions throughout.

## 31. Reward calculation — units, precision and rounding

Solidity has no fractions, so `0.001` is an integer scaled by 18 decimals:

```text
rewardRate       = 1e15   RWD base units per WHOLE staked token per second  (= 0.001 RWD)
REWARD_PRECISION = 1e18   staked-token base units per whole token

accrued  = stakedBalance × rewardRate × elapsedSeconds / REWARD_PRECISION     (RWD base units)
earned() = pendingReward + accrued since lastUpdate
```

`stakedBalance` is in staked-token base units (100 LPT = `100000000000000000000`).
Check: `100e18 × 1e15 × 60 / 1e18 = 6e18` = **exactly 6 RWD**. Both tokens must
use 18 decimals for "per token" and "RWD" to mean whole tokens; the
constructor rejects anything else (e.g. 6-decimal MockUSDC).

**Rounding.** Multiplication happens before division, and the division rounds
**down**, in the contract's favour. Each checkpoint loses strictly less than one
RWD base unit (10⁻¹⁸ RWD), and only when `staked × rate × seconds` is not a
multiple of 10¹⁸ — never for whole-token stakes. Example: 1 base unit staked for
999 s earns `0`; at 1000 s it earns `1` base unit. Overflow is unreachable in
practice (1e30 base units staked for 100 years stays far below 2²⁵⁶).

**Accounting across stake changes.** Every `stake`, `withdraw`/`unstake`,
harvest/claim and `exit` first runs `_updateReward(user)`, which moves
everything accrued so far into `pendingReward` and resets `lastUpdate` to now.
So an additional stake never re-prices earlier time at the new size, and a
partial withdrawal never forfeits what was earned before it:

| Sequence | Reward | A contract that forgot to checkpoint |
| -------- | ------ | ------------------------------------ |
| stake 50, +60 s, stake 50 more, +60 s | 3 + 6 = **9 RWD** | 100 × 0.001 × 120 = 12 |
| stake 100, +60 s, withdraw 40, +60 s | 6 + 3.6 = **9.6 RWD** | 60 × 0.001 × 120 = 7.2 |

**Funding.** The contracts never mint RWD; they pay only from the RWD they
hold, minted to their address by the RWD owner (sheet step 5). A payout above
that balance reverts with `InsufficientRewardFunding` and the reward stays
pending — nobody is paid more than the contract can fund, nothing is silently
dropped, and there are no partial payouts. `withdraw`/`unstake` never touch RWD,
so a stake is always recoverable even from an unfunded contract. `exit()` is
all-or-nothing. Payouts are first come, first served from the shared balance.

**Timing on a real chain.** A transaction pays for the time up to the block it
is mined in, not the moment you click. On the in-process chain each mined block
adds one second, so a harvest sent "after 60 s" pays **6.1** RWD; on Sepolia
(~12 s blocks) expect roughly 6.0–7.5 RWD for "about 60 seconds".

## 32. Deployment

Nothing in this repository deploys automatically. Deploy only to the local
in-process chain, or to Sepolia once you have chosen to.

### Option A — Hardhat (scripted)

```bash
npx hardhat compile && npm run sync-abi        # after any contract change
npm run deploy:exp5                            # dry run on the in-process chain (addresses vanish)
npx hardhat keystore set SEPOLIA_RPC_URL       # once; never committed
npx hardhat keystore set SEPOLIA_PRIVATE_KEY   # once; never committed
npm run deploy:exp5:sepolia                    # real Sepolia deployment — costs gas
```

The script performs the sheet's steps 1–5 for **both** parts — deploy the two
MockERC20s, mint **100 LPT / 100 ABC** to the deployer, deploy the reward
contract, mint **1 000 RWD** to it — checks the wiring (`stakingToken`,
`rewardToken`, `rewardRate`), and refuses to report success otherwise. It writes
`deployments/<network>-experiment5.json` (never overwriting an existing record;
a timestamped file is written instead) and prints the six `VITE_*` lines for
`frontend/.env`. It does **not** approve, stake or harvest — that is the
experiment.

### Option B — Remix

Compiler **0.8.28**, EVM version default (cancun or later), *Injected Provider —
MetaMask* on Sepolia. OpenZeppelin imports resolve from npm automatically.
Amounts are **base units** (18 decimals): 100 tokens = `100000000000000000000`,
1000 RWD = `1000000000000000000000`, 40 tokens = `40000000000000000000`.

Part 1 (Part 2 is identical with `"Protocol Token","ABC"`, `SimpleStaking`,
`claimReward`, `unstake`):

1. Deploy `MockERC20` with `"LP Token","LPT"` → copy the LPT address.
2. Deploy `MockERC20` again with `"Reward Token","RWD"` → copy the RWD address.
3. On LPT: `mint(<your address>, 100000000000000000000)`.
4. Deploy `SimpleYieldFarm` with `(<LPT>, <RWD>)`.
5. On RWD: `mint(<farm address>, 1000000000000000000000)`.
6. On LPT: `approve(<farm address>, 100000000000000000000)`.
7. On the farm: `stake(100000000000000000000)`.
8. `stakedBalance(<you>)` → `100000000000000000000`.
9. Wait ~60 s; `earned(<you>)` → ≈ `6000000000000000000` (6 RWD; more if longer).
10. `harvest()`; on RWD `balanceOf(<you>)` shows the RewardPaid amount.
11. Wait; `withdraw(40000000000000000000)`.
12. LPT `balanceOf(<you>)` → 40 LPT; `stakedBalance(<you>)` → 60 LPT.
13. `exit()` → 60 LPT back, pending RWD paid.

### Deployed Sepolia addresses

**Not deployed yet.** Fill these in only from a real deployment's output or a
block explorer — never from the local dry run:

| Part | Contract | Address | Deploy tx |
| ---- | -------- | ------- | --------- |
| 1 | LPT (MockERC20) | _pending_ | _pending_ |
| 1 | RWD (MockERC20) | _pending_ | _pending_ |
| 1 | SimpleYieldFarm | _pending_ | _pending_ |
| 2 | ABC (MockERC20) | _pending_ | _pending_ |
| 2 | RWD (MockERC20) | _pending_ | _pending_ |
| 2 | SimpleStaking | _pending_ | _pending_ |

Then set them in `frontend/.env` (the keys are already there, empty) and
restart `npm run dev`:

```bash
VITE_LPT_ADDRESS=0x...
VITE_FARM_RWD_ADDRESS=0x...
VITE_YIELD_FARM_ADDRESS=0x...
VITE_ABC_ADDRESS=0x...
VITE_STAKING_RWD_ADDRESS=0x...
VITE_STAKING_ADDRESS=0x...
```

Each part works on its own: the UI enables a part as soon as its three
addresses are set.

## 33. Interaction sequence — running it

```bash
npm run test:exp5        # Experiment 5 tests only (84)
npm run demo:exp5        # both parts' 13-step sequences, printed with tx hashes & events
cd frontend && npm run dev   # http://localhost:5173/#/experiment-5
```

`npm run demo:exp5` deploys fresh contracts on the in-process chain and
simulates the waits by advancing block time. Its output (abridged) from this
repository:

| Step | Part 1 (farm) | Part 2 (staking) |
| ---- | ------------- | ---------------- |
| earned() after 60 s | 6.0 RWD | 6.0 RWD |
| harvest() / claimReward() mined at 61 s | 6.1 RWD paid | 6.1 RWD paid |
| withdraw(40) / unstake(40) 61 s later | 40 back, **60 staked**, 6.1 pending | same |
| exit() 61 s later | 60 back, 9.76 RWD paid | same |
| totals | 100 LPT returned, 15.86 RWD earned | 100 ABC returned, 15.86 RWD earned |

`9.76 = 6.1 (100 × 61 s) + 3.66 (60 × 61 s)`. These are **local, simulated**
values — evidence for Sepolia must come from your own transactions.

**In the UI** (`#/experiment-5`, MetaMask on Sepolia, the deployer wallet):

1. Choose **Part 1 · Yield Farming** (or **Part 2 · Protocol Staking**).
2. *Your position* shows live `stakedBalance`, on-chain `earned()` with the
   block it was read at, a **calculated** "Projected now" that ticks every
   second, the reward rate, `totalStaked`, and the contract's RWD funding with
   an estimated runway.
3. *Wallet* shows LPT/ABC and RWD balances, the allowance, and links to all
   three contracts. Owner-only controls mint LPT/ABC to you and fund the
   contract with RWD.
4. *Stake*: enter `100` → **Approve** → **Stake** (two MetaMask confirmations).
5. Wait ~60 s, watch *Rewards*, then **Harvest RWD** / **Claim reward RWD**.
6. *Withdraw* / *Unstake*: enter `40` — the preview shows 60 remaining.
7. **Exit** returns the rest and pays everything pending.

Every confirmed transaction shows its hash and decoded events in *Transaction
Status*, and is listed in the *Session Log* with the amounts from its own
events. Payouts the contract cannot fund are blocked before MetaMask opens,
with the shortfall explained; reverts are explained with the contract's numbers.

### Evidence checklist

- [ ] Deployed addresses of LPT, RWD, SimpleYieldFarm (and ABC, RWD, SimpleStaking)
- [ ] LPT/ABC mint and approval transactions — hashes, updated allowance
- [ ] `stake()` transaction and `stakedBalance` = 100
- [ ] `earned()` after ~60 s (≈ 6 RWD)
- [ ] `harvest()` / `claimReward()` hash and the resulting RWD balance
- [ ] `withdraw(40)` / `unstake(40)` hash; wallet 40, stake 60
- [ ] `exit()` hash; stake 0, all tokens returned, pending RWD paid
- [ ] Observation (§34)

## 34. Observations and conclusion

**Observations** (from the tests and the local demo; confirm on Sepolia):

* Rewards grow **linearly** with both stake and time: 0.1 RWD/s for 100 tokens,
  0.06 RWD/s after withdrawing 40.
* Harvest/claim pays the reward up to the block it is **mined** in, so the paid
  amount is slightly above the value seen in `earned()` a moment earlier.
* A partial withdrawal **does not pay** rewards and **does not lose** them: they
  are checkpointed into `pendingReward` and paid by the next harvest or `exit()`.
* Staking more, or withdrawing part, re-checkpoints first, so earlier time is
  never re-priced at the new stake size.
* An under-funded contract refuses payouts (`InsufficientRewardFunding`) while
  still returning the staked tokens.
* Yield farming and protocol staking behave identically **mechanically** here;
  the difference is economic. LPT represents an AMM position that is exposed to
  impermanent loss and earns trading fees in its pool, with farming rewards as a
  separate stream on top. ABC staking involves no pool, so no impermanent loss
  and no trading fees — only the protocol's reward.

**Conclusion.** Both reward mechanisms were implemented with the sheet's
time-based model in exact integer arithmetic (0.001 RWD = 1e15 base units per
token per second), with rewards checkpointed before every stake change and
payouts limited to the RWD actually held. The full lifecycle — mint, approve,
stake, accrue, harvest/claim, partial withdrawal/unstake, exit — is verified by
automated tests on a local chain and is available in the VaultWise UI for the
Sepolia demonstration.

## 35. Tests

`npm test` runs **256** tests (48 Experiment 3, 65 Experiment 4, 84 Experiment 5,
59 Experiment 6).
`npm run test:exp5` runs only the 84 Experiment 5 tests:

* `test/experiment5.test.js` (74) — the same behavioural suite run against
  **both** SimpleYieldFarm and SimpleStaking: token deployment and owner-only
  minting; constructor validation; approval and staking; exact reward accrual
  (6 RWD at 60 s, linearity, floor rounding); harvest/claim and no double
  payment; partial withdrawal/unstake with preserved rewards; full exit;
  zero-value rejection; insufficient balance and allowance; excessive
  withdrawal; **insufficient and partial reward funding** (no partial payouts,
  stake still recoverable, `exit` all-or-nothing, first come first served);
  **reward preservation** across stake → stake, stake → withdraw → stake, and
  between users; **reentrancy** through both the staking token (during `stake`)
  and the reward token (during payout); fee-on-transfer and return-`false`
  tokens; tokens sent without staking. Plus the sheet's full 13-step sequence
  for each part with exact expected values.
* `test/experiment5.frontend.test.js` (10) — the UI's reward projection
  (checked against the contract's own `earned()` at a later block), funding
  runway, payout funding check, and revert explanations decoded from real
  reverts of both contracts.

Timing in tests is pinned with `setNextBlockTimestamp`, so every expected
reward is exact. Not automated: React rendering and live MetaMask interaction.

# Part E — Experiment 6: Building a Decentralised Exchange (DEX) Prototype

## 36. Aim and theory

**Aim.** Build a working DEX in Solidity from a Factory, Pairs and a Router;
implement the constant-product swap with the **0.3 % fee** and predict its
output by hand; handle approvals, `transferFrom`, reserves, minimum output,
deadlines and events; and test it with the sheet's numeric scenarios.

**The car analogy.** The DEX is the car, the AMM is the engine, the pool is the
fuel tank, and liquidity providers fill the tank.

| Contract | Role in the analogy | Key functions | Required? |
| -------- | ------------------- | ------------- | --------- |
| ERC20 (token and LP token) | the fuel, and the receipt for your share of the tank | `transfer`, `approve`, `transferFrom` | required |
| `Pair` | fuel tank and engine: holds reserves, runs the AMM | `mint`, `burn`, `swap` | required |
| `Factory` | the assembly line: one Pair per token combination | `createPair`, `getPair` | required |
| `Router` | dashboard and steering: the safe entry point | `addLiquidity`, `removeLiquidity`, `swapExactTokensForTokens` | required |
| `DexMockERC20` (the sheet's MockERC20) | test fuel anyone can mint | `mint` | required for tests |
| `LPFarm` | rewards programme for LPs who stake | `deposit`, `withdraw`, `pendingReward` | optional |

Three design rules hold it together:

1. **The Pair is simple and strict.** It never pulls tokens from users. It
   works out what it received (`balance − reserve`) and reverts if the maths
   is wrong.
2. **The Router is friendly and safe.** It pulls tokens with `transferFrom`,
   sends them straight to the Pair, applies slippage and deadline checks, and
   routes multi-hop trades.
3. **Anyone can list a token.** `createPair` needs no permission.

## 37. Contract architecture

```text
user ─ approve(Router) ─▶ token A
user ─ swapExactTokensForTokens / addLiquidity / removeLiquidity ─▶ Router
Router ─ getPair / createPair ─▶ Factory ─ CREATE2 + initialize ─▶ Pair
Router ─ transferFrom(user → Pair) ─▶ token A           (the Pair never pulls)
Router ─ swap(amount0Out, amount1Out, to) / mint(to) / burn(to) ─▶ Pair
Pair ─ transfer(output) ─▶ next Pair (multi-hop) or the user
```

**ERC20.** OpenZeppelin's `ERC20` already meets the sheet's specification —
name/symbol/18 decimals/totalSupply/balanceOf/allowance, `transferFrom`
lowering a finite allowance but leaving `2²⁵⁶ − 1` untouched, `Transfer` and
`Approval` events, internal `_mint`/`_burn` — so it is reused, not rewritten.
`Pair` inherits it, so **every Pair is its own LP token** (`VWDEX-LP`, 18 decimals).

**Why `DexMockERC20` and not `MockERC20`.** The sheet's MockERC20 has a
**public** `mint`. Experiment 4's `MockERC20` (owner-only mint) already owns
that contract name, and a second `MockERC20` would make
`getContractFactory("MockERC20")` ambiguous and break Experiments 4–5.

**Pair** — state `factory`, `token0`, `token1`, `reserve0`, `reserve1` + LP ERC-20.

| Function | Behaviour |
| -------- | --------- |
| `initialize(token0, token1)` | once, Factory only (`FORBIDDEN`, `ALREADY_INITIALIZED`) |
| `mint(to)` | `amountX = balanceX − reserveX`; first deposit `√(a0·a1) − 1000` (+1000 locked), later `min(a0·S/r0, a1·S/r1)` |
| `burn(to)` | burns the LP already sent to the Pair; returns `LP·balanceX/S` of each |
| `swap(amount0Out, amount1Out, to)` | pays out first, derives inputs from balances, enforces the fee-adjusted invariant |
| events | `Mint(sender, amount0, amount1, liquidity, to)`, `Burn(sender, amount0, amount1, liquidity, to)`, `Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to)`, `Sync(reserve0, reserve1)` |

`mint`, `burn` and `swap` are guarded by `ReentrancyGuardTransient`.
OpenZeppelin cannot mint to `address(0)`, so the 1,000 locked LP go to the
standard burn address `0x…dEaD` — equally unspendable, still in `totalSupply`.

**Factory** — `createPair` rejects identical tokens (`IDENTICAL_ADDRESSES`),
the zero address (`ZERO_ADDRESS`) and an existing pair (`PAIR_EXISTS`), sorts
the addresses, deploys the Pair with **CREATE2** (salt `keccak256(token0, token1)`,
so a pair's address is predictable), calls `initialize`, stores it under both
orderings and in `allPairs`, and emits `PairCreated(token0, token1, pair, length)`.

**Router** — `addLiquidity` (creates the pair if missing, keeps the ratio,
enforces minimums), `removeLiquidity`, `swapExactTokensForTokens` (deadline →
all hop outputs → minimum output → `transferFrom` into the first Pair → chained
`swap`s), and helpers `getAmountOut`, `getAmountsOut`, `quote`, `sortTokens`,
`getReserves`. It holds no tokens between calls and is itself
`nonReentrant`. Missing pools revert with `PAIR_NOT_FOUND(tokenA, tokenB)`.

**Errors** use the sheet's names verbatim as custom errors: `K`,
`INSUFFICIENT_INPUT_AMOUNT`, `INSUFFICIENT_OUTPUT_AMOUNT`, `EXPIRED`,
`PAIR_EXISTS`, `INSUFFICIENT_LIQUIDITY(_MINTED/_BURNED)`,
`INSUFFICIENT_A_AMOUNT`, `INSUFFICIENT_B_AMOUNT`, `INVALID_PATH`, `INVALID_TO`.

**LPFarm (optional)** — `accRewardPerShare += elapsed·rewardPerSecond·1e18/totalStaked`;
`pending = amount·acc/1e18 − rewardDebt`; no loops over users. `deposit(0)` claims.
Payouts are capped at the farm's reward balance and any shortfall is carried in
`unpaidReward`, so an unfunded farm never blocks an LP withdrawal. Rounding is
down, so the farm never pays more than it emitted.

## 38. Formulas

All divisions are whole-number divisions rounding **down**, in the pool's favour.

```text
Swap output (Router):     amountInWithFee = amountIn × 997
                          amountOut = amountInWithFee × reserveOut / (reserveIn × 1000 + amountInWithFee)
Invariant (Pair.swap):    (bal0·1000 − in0·3) · (bal1·1000 − in1·3) ≥ reserve0 · reserve1 · 1000²   else K
LP minted:                first  √(amount0 · amount1) − 1000      later  min(a0·S/r0, a1·S/r1)
LP burned:                share × balance ÷ supply, per token
Ratio quote (Router):     amountB = amountA × reserveB / reserveA
```

The fee is not a separate variable: it stays in the reserves, so `k` grows
after every trade (scenario 2: 2,000,000 → 2,000,900).

**Units.** The sheet's scenarios are in **raw base units** — "1,000 A" is the
integer 1000 the contract sees. That is the only scale at which "1,000 LP to
the depositor, 1,000 locked" holds; with 18-decimal whole tokens the lock is
just 10⁻¹⁵ LP and the depositor gets ≈ 2,000 LP. The UI works in whole tokens,
so the same 100-into-1,000/2,000 trade there pays **181.3221787760…** B — the
same formula, without the integer truncation to 181.

## 39. Testing scenarios — results

All ten are automated in `test/experiment6.test.js` and printed by
`npm run demo:exp6`, with every expected number recomputed independently.

| # | Scenario | Hand calculation | Result (local chain) |
| - | -------- | ---------------- | -------------------- |
| 1 | First deposit 1,000 A + 4,000 B | √4,000,000 − 1000 = 1000 | LP 1,000; locked 1,000; supply 2,000; reserves 1,000/4,000 ✔ |
| 2 | Pool 1,000 A / 2,000 B, sell 100 A | 199,400,000 / 1,099,700 = 181.3 → 181 | 181 B; reserves 1,100/1,819; k = 2,000,900 ✔ |
| 3 | Same, ask 182 B | 1,099,700 · 1,818,000 < 2·10¹² | reverts `K` ✔ |
| 4 | `swap(0, 181, trader)` with no A sent | inputs = 0 | reverts `INSUFFICIENT_INPUT_AMOUNT` ✔ |
| 5 | Another trader sells 20 A, then 100 A, min 179 | 20 A → 39 B; pool 1,020/1,961; 100 A → 174 B | reverts `INSUFFICIENT_OUTPUT_AMOUNT` ✔ |
| 6 | Deadline in the past | — | reverts `EXPIRED` ✔ |
| 7 | Router approved for 100 A, swap 200 A | — | reverts in `transferFrom` (`ERC20InsufficientAllowance(router, 100, 200)`) ✔ |
| 8 | 1,000 A/2,000 B and 4,000 B/500 C, sell 100 A along A→B→C | 181 B; 180,457·500/4,180,457 = 21.6 → 21 | 21 C; pools 1,100/1,819 and 4,181/479 ✔ |
| 9 | Pool 1,000/4,000, supply 2,000; desire 500 A + 3,000 B | quote(500) = 2,000 ≤ 3,000 | uses 500 A + 2,000 B; mints 1,000 LP ✔ |
| 10 | `createPair` again | — | reverts `PAIR_EXISTS` ✔ |

Also from the build-order milestones: burning the first LP's 1,000 LP returns
**500 A + 2,000 B** ✔, and `getPair(A, B) == getPair(B, A)` ✔. The sheet's
numbers are internally consistent; no expected value had to be changed.

## 40. Deployment

Nothing is deployed automatically. `deploy:exp6:sepolia` is a separate,
explicit step that costs Sepolia gas.

```bash
npx hardhat compile && npm run sync-abi        # after any contract change
npm run deploy:exp6                            # dry run on the in-process chain
npm run deploy:exp6:sepolia                    # real Sepolia deployment (keystore password asked)
```

The script deploys `DexMockERC20` ×3 (DXA, DXB, DXC), `Factory`, `Router(Factory)`,
mints 10,000 of each token to the deployer, checks `Router.factory()` and an
empty Factory, writes `deployments/<network>-experiment6.json` (never over an
existing record), and prints five lines for `frontend/.env`:

```bash
VITE_DEX_FACTORY_ADDRESS=0x...
VITE_DEX_ROUTER_ADDRESS=0x...
VITE_DEX_TOKEN_A_ADDRESS=0x...
VITE_DEX_TOKEN_B_ADDRESS=0x...
VITE_DEX_TOKEN_C_ADDRESS=0x...
```

Pairs are not configured — the app finds them with `Factory.getPair`. Add these
keys to `frontend/.env` yourself after a real deployment (the repository never
edits that file for Experiment 6); `.env.example` documents them.

**Remix** (compiler 0.8.28, EVM default): deploy `DexMockERC20` three times with
`("Token A","DXA")`, `("Token B","DXB")`, `("Token C","DXC")`; deploy `Factory`;
deploy `Router` with the Factory address. `Pair` is never deployed by hand.

### Deployed Sepolia addresses

**Not deployed yet.** Fill in only from a real deployment's output:

| Contract | Address | Deploy tx |
| -------- | ------- | --------- |
| DXA (DexMockERC20) | _pending_ | _pending_ |
| DXB (DexMockERC20) | _pending_ | _pending_ |
| DXC (DexMockERC20) | _pending_ | _pending_ |
| Factory | _pending_ | _pending_ |
| Router | _pending_ | _pending_ |

## 41. Using the DEX (UI) and evidence

```bash
npm run test:exp6         # the 59 Experiment 6 tests
npm run demo:exp6         # the ten scenarios with console output (local)
cd frontend && npm run dev   # http://localhost:5173/#/experiment-6
```

1. **Tokens.** *Wallet* shows DXA/DXB/DXC balances and each token's allowance
   to the **Router**. Mint test tokens with the faucet (public — any wallet).
2. **Approve.** Every action approves the Router, never a Pair: the Router
   moves your tokens straight into the Pair with `transferFrom`.
3. **Provide liquidity.** *Liquidity → Add* on DXA/DXB: enter 1000 and 4000.
   On an empty pool you set the price. Approve DXA → Approve DXB → Add. The
   pair is created automatically if needed. On an existing pool the other side
   fills at the pool ratio, and an off-ratio warning shows exactly what the
   Router will use (scenario 9). Minimums are 0.5 % below.
4. **Pools** shows every pair's address, reserves, spot price, `k`, LP supply,
   and your LP and share, read live at a stated block. *Create pair* calls
   `Factory.createPair` directly.
5. **Swap.** Choose Sell/Buy tokens and an amount. Routes are listed — direct,
   and through the third token (multi-hop) — with each hop's calculated
   output; the best is preselected. Set the slippage tolerance or type
   `amountOutMin`, and the deadline in minutes (measured from chain time).
   Approve → Swap. Right before MetaMask opens, the app re-quotes with
   `Router.getAmountsOut` and stops if the price already moved below your minimum.
6. **Remove liquidity.** Enter LP (or Max) → Approve LP → Remove.

Every confirmed transaction shows its hash and decoded events (`Mint`, `Burn`,
`Swap`, `Sync`, `PairCreated`, `Transfer`, `Approval`) in *Transaction
Status*, and a result card built from the receipt. Reverts are explained using
the sheet's error names.

**Evidence checklist**

- [ ] `npm run test:exp6` output (59 passing) and `npm run demo:exp6` output (scenarios 1–10)
- [ ] Deployed addresses of DXA, DXB, DXC, Factory, Router — with hashes
- [ ] Approval transactions and the updated Router allowances
- [ ] `addLiquidity` creating DXA/DXB (`PairCreated`, `Mint`, `Sync`), and the Pools row
- [ ] A swap with its `Swap`/`Sync` events, reserves before/after and `k` growing
- [ ] A multi-hop swap DXA → DXB → DXC (needs DXA/DXB and DXB/DXC pools)
- [ ] A reverted swap with a too-high `amountOutMin` (INSUFFICIENT_OUTPUT_AMOUNT), shown before or after sending
- [ ] `removeLiquidity` with the `Burn` event and returned amounts

## 42. Observations and conclusion

* The Router quotes and the Pair verifies. Asking for one unit more than the
  formula gives fails `K` (tested at many sizes).
* The 0.3 % fee raises `k` after every trade, so LPs earn from swaps without
  any fee variable.
* The 1,000 locked LP make the first deposit's share price impossible to
  reset to zero.
* Slippage protection is on-chain (`amountOutMin`, `EXPIRED`): a front-run
  that moves the price makes the victim's swap revert instead of filling at
  174 instead of 181.
* Multi-hop routing compounds fees and price impact per hop. 100 A only buys
  21 C because the second pool is small.

**Conclusion.** A Uniswap-V2-style DEX was built from a Pair (pool, AMM and
LP token), a permissionless Factory and a Router, with the exact 0.3 % fee
formula and the fee-adjusted invariant. All ten of the sheet's scenarios give
exactly the expected results on a local chain, and the optional LPFarm
distributes rewards proportionally without loops.

---

## Security notes

This is an **educational testnet project**. Use testnet funds only, and never
send real ETH or real tokens to any contract in this repository.

### Keys and secrets

* No private key or seed phrase exists anywhere in this repository, and none
  should ever be added. `.gitignore` blocks `.env*` files, `*.key` and `*.pem`.
* Deployment keys go in Hardhat's **encrypted keystore**
  (`npx hardhat keystore set SEPOLIA_PRIVATE_KEY`), never in a file in the repo.
* Every `VITE_*` variable is inlined into the public browser bundle. Only
  contract addresses belong there — never a key.
* Use a throwaway deployment wallet funded from a faucet, never one holding real
  funds.

### Experiment 1 — the ETH vault

* `withdraw()` follows **checks-effects-interactions**: balances are decremented
  before ETH is sent, so re-entrancy gains nothing.
* Users can only ever withdraw what they themselves deposited.
* ETH is sent with `call` rather than `transfer`, the currently recommended pattern.
* Plain ETH transfers to the contract revert, so no ETH can arrive uncredited.

### Experiment 3 — the ERC-20 and ERC-4626 contracts

* **Nothing is re-implemented.** All ERC-20 and ERC-4626 accounting is inherited
  from OpenZeppelin v5 and **no ERC-4626 function is overridden**, so the
  standard's semantics are exactly preserved.
* **No double accounting.** The vault keeps no deposit mapping of its own — the
  share balances *are* the ledger. A second ledger alongside them would
  inevitably drift.
* **No uncredited transfers.** `totalAssets()` reports the vault's real token
  balance, so assets sent directly to the vault are correctly counted as a gain
  shared across all existing shares rather than being lost.
* **The approval flow is standard.** The vault pulls with `transferFrom` and
  respects the allowance; it never assumes an approval it does not have.
* **Shares are freely transferable**, not soulbound — as ERC-4626 requires.
* **Share inflation** is mitigated by OpenZeppelin v5's virtual assets and
  shares, not by custom code.
* `mint()` on MockUSDC is **owner-only**. It is laboratory scaffolding for
  handing out test balances, and MockUSDC has no value of any kind.
* Solidity ≥0.8 gives built-in overflow/underflow protection throughout.

The VaultWise-specific `vaultProfile()` feature is `constant` metadata plus live
reads. It writes no storage, no ERC-4626 function consults it, and a test
asserts that calling it leaves share accounting untouched.

### Experiment 4 — the AMM pool

* **Educational and no-fee — not production-ready.** There is no swap fee, no
  `minAmountOut` slippage parameter (the sheet fixes the signatures), and no
  minimum-liquidity lock. The UI re-quotes before a swap, but the contract
  cannot protect against reserves moving before the transaction is mined.
* **Reserves are recorded, not read from balances**, so tokens transferred
  directly to the pool are ignored and cannot move the price.
* **Atomicity.** State is written before tokens move (checks → effects →
  interactions), and any failed transfer reverts the whole call — LP shares can
  never exist without the assets behind them. Tests assert this.
* **Rounding favours the pool**: swaps round the new output reserve up and
  removals round payouts down.
* **Assumes plain ERC-20s with compatible decimals** (both TKA and TKB use 18).
  Fee-on-transfer and rebasing tokens are not supported.
* `ReentrancyGuardTransient` needs EIP-1153 (Sepolia: yes; compile for cancun or later).
* **Slippage** is limited only client-side: the UI simulates the swap right
  before signing and refuses if the output is below your tolerance. On-chain
  protection would need a `minAmountOut` parameter, i.e. a new contract version
  and redeployment.
* No admin functions: the pool has no owner, pause, fee switch or withdrawal
  backdoor. Only the test tokens' `mint` is owner-restricted.

### Experiment 5 — yield farm and staking

* **Educational and accelerated — not production-ready.** The reward rate is a
  fixed constant chosen for classroom observation; there is no emission
  schedule, reward period, lock-up or admin control.
* **Rewards are capped by funding.** The contracts pay only from the RWD they
  hold and revert rather than over-pay or part-pay. Funding is shared and first
  come, first served; nothing reserves RWD for a particular user.
* **Principal is always recoverable**: `withdraw`/`unstake` never depend on RWD.
* **Rewards are checkpointed before every stake change**, so they are neither
  lost nor inflated by additional stakes or partial withdrawals. Tests assert this.
* **Rounding favours the contract** (floor division, < 1 base unit per checkpoint).
* **Token assumptions:** 18 decimals (enforced), staking ≠ reward token
  (enforced), no fee-on-transfer staking tokens (detected and rejected), no
  rebasing tokens.
* `SafeERC20`, checks → effects → interactions, and `ReentrancyGuardTransient`
  (EIP-1153) on every state-changing function; reentrancy through both tokens is
  tested.
* No admin functions: neither contract has an owner, pause, rate setter or
  withdrawal backdoor. Only the test tokens' `mint` is owner-restricted.

### Experiment 6 — the DEX

* **Educational prototype, not production-ready.** No flash-swap callback, no
  protocol fee, no price oracle, no `skim`/`sync`; tokens sent to a Pair
  directly are credited to the next `mint` or `swap` (as in Uniswap V2).
* **The Pair never pulls tokens** and checks the fee-adjusted invariant after
  paying out, so it can't be drained by mis-quoted inputs; `mint`, `burn`,
  `swap` and every Router entry point are `nonReentrant`. Re-entry through a
  hostile token is tested for both the Pair and the Router.
* **Slippage and deadline are enforced on-chain** (`amountOutMin`, `amountAMin`/`amountBMin`, `deadline`).
* **Unsupported tokens:** fee-on-transfer (swaps revert with `K`) and rebasing
  tokens. `DexMockERC20.mint` is public — the demo tokens have no value.
* **Reserves are `uint256`** with checked arithmetic. The invariant product
  overflows (reverts) only above ~10³⁵ base units per reserve.
* **LPFarm** pays only from its balance and carries any shortfall; there is no
  owner, no rate change and no emergency withdrawal function.
* No admin functions anywhere: no owner, pause or fee switch.

## License

MIT — for educational use.
