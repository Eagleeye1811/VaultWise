# VaultWise

> Your simple decentralized asset vault.

**Experiment 1 — Building an Advanced DApp using React and Ethers.js**
**Experiment 3 — Deploying and Interacting with ERC-4626 Vault Contracts**

---

## 1. What VaultWise is

VaultWise is a DeFi treasury / vault management project built across **10 experiments**.
Each experiment adds one layer on top of the previous one:

| #  | Experiment                              | Status              |
| -- | --------------------------------------- | ------------------- |
| 1  | React + Ethers.js DApp                  | ✅ **implemented**   |
| 2  | WalletConnect + MetaMask                | planned             |
| 3  | ERC-4626 Vault                          | ✅ **implemented**   |
| 4  | AMM Liquidity Pool                      | planned             |
| 5  | Yield Farming + Staking                 | planned             |
| 6  | DEX Prototype                           | planned             |
| 7  | Chainlink Price Feed Oracle             | planned             |
| 8  | DAO Voting                              | planned             |
| 9  | Flash Loan Attack + Security Mitigation | planned             |
| 10 | Ethereum / Polygon Testnet Deployment   | planned             |

This repository contains **Experiments 1 and 3**. Both are reachable from the same
React app, which has an experiment switcher in the navigation bar.

There are deliberately still no AMM, no liquidity pools, no yield strategy, no
staking, no DEX, no DAO, no oracles, no flash loans and no backend. Experiment 3
adds exactly one layer: an ERC-20 token and an ERC-4626 tokenized vault built on
top of it.

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
│   └── experiment3/
│       ├── MockUSDC.sol             # Exp 3 — ERC-20 underlying asset, 6 decimals
│       └── VaultWiseVault.sol       # Exp 3 — ERC-4626 tokenized vault
│
├── test/
│   └── experiment3.test.js          # 48 tests over the full ERC-4626 lifecycle
│
├── scripts/
│   ├── deployExperiment3.js         # MockUSDC -> mint -> vault, with assertions
│   ├── experiment3Lifecycle.js      # prints experiment Steps 1-12 end to end
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
│       │   └── experiment3/         # ERC-4626 view
│       │       ├── Erc4626View.jsx      # reads, writes, wiring
│       │       ├── VaultProfileCard.jsx # the VaultWise-specific feature
│       │       ├── Erc4626Stats.jsx     # assets / shares / your position
│       │       ├── AssetWalletCard.jsx  # USDC balance, allowance, faucet
│       │       ├── DepositPanel.jsx     # deposit() and mint()
│       │       ├── WithdrawPanel.jsx    # withdraw() and redeem()
│       │       ├── ConversionPanel.jsx  # convertToShares / convertToAssets
│       │       └── contracts.js         # read/write contract instances
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

## License

MIT — for educational use.
