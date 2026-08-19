# VaultWise

> Your simple decentralized asset vault.

**Experiment 1 — Building an Advanced DApp using React and Ethers.js**

---

## 1. What VaultWise is

VaultWise is a DeFi treasury / vault management project built across **10 experiments**.
Each experiment adds one layer on top of the previous one:

| #  | Experiment                              | Status         |
| -- | --------------------------------------- | -------------- |
| 1  | React + Ethers.js DApp                  | ✅ **this repo** |
| 2  | WalletConnect + MetaMask                | planned        |
| 3  | ERC-4626 Vault                          | planned        |
| 4  | AMM Liquidity Pool                      | planned        |
| 5  | Yield Farming + Staking                 | planned        |
| 6  | DEX Prototype                           | planned        |
| 7  | Chainlink Price Feed Oracle             | planned        |
| 8  | DAO Voting                              | planned        |
| 9  | Flash Loan Attack + Security Mitigation | planned        |
| 10 | Ethereum / Polygon Testnet Deployment   | planned        |

This repository currently contains **Experiment 1 only**. There are deliberately no
tokens, no shares, no yield, no AMM, no staking, no oracles and no backend.

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

| Layer          | Choice                                   |
| -------------- | ---------------------------------------- |
| Smart contract | Solidity `^0.8.20`                       |
| Contract tool  | Remix IDE (compile + deploy, in-browser) |
| Frontend       | React 19 + Vite                          |
| Language       | JavaScript (JSX)                         |
| Blockchain lib | Ethers.js **v6**                         |
| Styling        | Plain CSS                                |
| Wallet         | MetaMask                                 |
| Network        | Sepolia testnet                          |

Deliberately **not** used: Hardhat, Foundry, Next.js, Wagmi, RainbowKit, Viem,
Web3.js, Redux, Firebase, any backend, any database.

---

## 4. Project structure

```
VaultWise/
├── contracts/
│   └── VaultWiseVault.sol           # the ETH vault contract
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example                 # copy to .env.local for your address
│   └── src/
│       ├── main.jsx                 # React entry point
│       ├── App.jsx                  # all ethers.js wiring + app state
│       ├── index.css                # global blue/white fintech styling
│       ├── components/
│       │   ├── Navbar.jsx           # brand, network pill, connect button
│       │   ├── VaultStats.jsx       # the three headline numbers
│       │   ├── DepositCard.jsx      # deposit form + input validation
│       │   ├── WithdrawCard.jsx     # withdraw form + input validation
│       │   └── TransactionStatus.jsx# pending / confirmed / failed + tx hash
│       ├── contracts/
│       │   └── contractConfig.js    # ⭐ CONTRACT_ADDRESS + CONTRACT_ABI
│       └── utils/
│           └── errors.js            # raw errors → friendly messages
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

Requires **Node.js 18+** (tested on Node 24).

```bash
cd frontend
npm install
```

## 6. Run the React frontend

```bash
cd frontend
npm run dev
```

Then open the URL it prints — normally <http://localhost:5173>.

Other commands:

```bash
npm run build     # production build into frontend/dist
npm run preview   # serve the production build locally
npm run lint      # static checks
```

> The app runs before you deploy anything, but it will show an orange banner
> saying the contract address is not set, and Deposit/Withdraw stay disabled.

---

## 7. Deploy the contract using Remix

1. Open <https://remix.ethereum.org>.
2. In the **File Explorer**, create a new file named `VaultWiseVault.sol`.
3. Copy the entire contents of `contracts/VaultWiseVault.sol` from this repo and
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

The ABI for the shipped contract is **already included** in
`frontend/src/contracts/contractConfig.js`, so normally you can skip this step.

If you modify `VaultWiseVault.sol`, regenerate it:

1. Remix → **Solidity Compiler** tab → compile the file.
2. At the bottom of that tab, click the **ABI** copy button.
3. That copies a JSON array to your clipboard.

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

Then set:

```
VITE_CONTRACT_ADDRESS=0xYourDeployedAddressHere
```

Restart `npm run dev` afterwards — Vite only reads env files at startup.

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

## Security notes

This is an **educational testnet project**.

* No private key or seed phrase exists anywhere in this repository, and none
  should ever be added. `.gitignore` blocks `.env*` files, `*.key` and `*.pem`.
* `withdraw()` follows **checks-effects-interactions**: balances are decremented
  before ETH is sent, so re-entrancy gains nothing.
* Users can only ever withdraw what they themselves deposited.
* Solidity ≥0.8 gives built-in overflow/underflow protection.
* ETH is sent with `call` rather than `transfer`, the currently recommended pattern.
* Plain ETH transfers to the contract revert, so no ETH can arrive uncredited.
* **Use testnet funds only. Never send real ETH to this contract.**

## License

MIT — for educational use.
