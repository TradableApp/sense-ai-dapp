# SenseAI dApp

[![CI](https://img.shields.io/github/actions/workflow/status/TradableApp/sense-ai-dapp/ci.yml?branch=main&label=CI)](https://github.com/TradableApp/sense-ai-dapp/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/TradableApp/sense-ai-dapp.svg)](./LICENSE)

This repository contains the source code for the SenseAI dApp, the primary frontend interface for the SenseAI tokenized AI agent. It is designed to be accessible both as a standalone web application and as a Telegram Mini App.

The dApp provides a seamless "Web2" user experience by leveraging the power of the Thirdweb SDK for non-custodial wallet creation and management, allowing users to interact with the SenseAI platform with ease.

## Technology Stack

This project is built with a modern, performant stack:

- **Framework**: [React](https://react.dev/) (with [Vite](https://vitejs.dev/))
- **Web3 Provider**: [Thirdweb SDK v5](https://thirdweb.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **State Management**: Redux Toolkit & React Query

---

## Getting Started (Frontend Only)

To get a local copy of just the frontend UI running (connected to public testnets), follow these steps.

### Prerequisites

- Bun (1.3.14+)
- Node.js (v18 or later, for toolchain binaries)

### Installation

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/TradableApp/sense-ai-dapp.git
    cd sense-ai-dapp
    ```

2.  **Install Dependencies:**

    ```sh
    bun install
    ```

3.  **Environment Setup:**
    Create a `.env` file by copying the example:

    ```sh
    cp .env.example .env
    ```

    Add your Thirdweb Client ID (from [Thirdweb Dashboard](https://thirdweb.com/dashboard/settings/api-keys)):

    ```env
    VITE_THIRDWEB_CLIENT_ID="YOUR_CLIENT_ID_HERE"
    ```

4.  **Run Development Server:**
    ```sh
    bun run dev:testnet
    ```
    _Note: We use `dev:testnet` here so you can interact with the app immediately using Base Sepolia. The standard `bun run dev` command requires a local blockchain node (see below)._

---

## Full Local Development Setup (Frontend + Contracts)

This guide explains how to set up the complete local environment. This is required if you want to modify smart contracts and see changes reflected in the dApp immediately.

### 1. Directory Structure

**Crucial:** The `sync-contracts` script copies the contract ABIs from sibling directories and stops before writing anything if one is missing. Clone these repositories into the same parent folder (or point `REPOS_ROOT` at the folder that holds them):

```text
.
├── sense-contracts/        # SenseToken, the fee token when VITE_FEE_TOKEN=SENSE
├── able-contracts/         # AbleToken, the fee token when VITE_FEE_TOKEN=ABLE
├── tokenized-ai-agent/     # The Agent & Escrow logic
└── sense-ai-dapp/          # This repository
```

### 2. Start the Local Blockchain

1.  Navigate to `tokenized-ai-agent`.
2.  Start the Hardhat node:
    ```sh
    bunx hardhat node
    ```
    This will start a local blockchain at `http://127.0.0.1:8545` and provide a list of 20 pre-funded test accounts. **Leave this terminal window running.**

### 3. Create a Secure Dev Wallet

For security, **never** import publicly-known private keys (like the ones from Hardhat) into your primary MetaMask wallet. Instead, create an isolated development environment using a separate browser profile.

1.  **Create a New Browser Profile:** In your browser (Chrome, Brave, etc.), go to Settings -> Profiles and create a new profile named "Web3 Dev".
2.  **Install MetaMask:** In the new "Web3 Dev" browser window, install a fresh MetaMask extension.
3.  **Create a Disposable Wallet:** When MetaMask starts, select **"Create a new wallet"**.
    - **IMPORTANT:** You do **not** need to save the Secret Recovery Phrase for this wallet. It is disposable and should never hold real funds. Choose to "Remind me later" when prompted to secure it.
4.  **Import Hardhat Account:**
    - In your new MetaMask, click the account dropdown, then **Add wallet -> Import account**.
    - Copy the **Private Key** for `Account #0` from the Hardhat node terminal.
    - Paste the key into MetaMask and click "Import". You should now see an account with a balance of 10000 ETH. Rename this account to "Hardhat #0" for clarity.

### 4. Deploy Smart Contracts

**Deploy the fee token:**

1.  Open a new terminal in `sense-contracts`.
2.  Run: `bun run deploy:localnet` (it reads that repository's `.env.localnet`, which names the token, its supply and its owner).
3.  **Copy** the `SenseToken proxy` address it prints.

**Deploy Agent:**

1.  Navigate to `tokenized-ai-agent`.
2.  Open `.env.base-localnet` (or create it). Set `TOKEN_CONTRACT_ADDRESS` to the address you just copied and `DEPLOY_MODE=fresh`, with `AI_AGENT_CONTRACT_ADDRESS` and `AI_AGENT_ESCROW_CONTRACT_ADDRESS` empty (the deploy refuses any other mode, and `fresh` refuses either pair address). On a local network the fees default when unset; a fresh pair on a live network needs them set and has a dry run first, in the order of the agent repository's deploy runbook ("Fresh pair, in order").
3.  Run: `bun run deploy:base-localnet`
4.  **Copy** the `EVMAIAgent` and `EVMAIAgentEscrow` addresses from the output, set them in `.env.base-localnet` and set `DEPLOY_MODE=upgrade`, so a second run upgrades this pair rather than deploying another.

**List the escrow on the token:**

`SenseToken` moves only to or from its owner or an address the owner has listed. From `tokenized-ai-agent`, run `bun run list-fee-token-exempt:base-localnet`: it lists the escrow and the escrow's treasury (`TREASURY_ADDRESS`, or the deployer when it is unset) when the signer is the token's owner, and otherwise prints the calls for the owner to send. A treasury that is the token's owner counts as listed (the owner is exempt by being the owner), so it is not sent. Until both are listed, the dApp's fee token check shows a notice and switches off the paid actions it names.

### 5. Configure the dApp

1.  Navigate to `sense-ai-dapp`.
2.  **Sync ABIs:**
    Run the sync script to copy the latest compiled contract artifacts from the sibling directories:
    ```sh
    bun run sync-contracts
    ```
3.  **Set the localnet settings:**
    In `.env.localnet` (the settings file Vite reads in `localnet` mode), set `VITE_CHAIN_ID=31337`, `VITE_FEE_TOKEN=SENSE`, and `VITE_TOKEN_CONTRACT_ADDRESS`, `VITE_AGENT_CONTRACT_ADDRESS` and `VITE_ESCROW_CONTRACT_ADDRESS` to the addresses from Step 4; `src/config/contracts.ts` reads the addresses from these settings. The other settings the app reads are declared in `src/vite-env.d.ts`. A build or dev server stops with the reason when `VITE_FEE_TOKEN` is not exactly `SENSE` or `ABLE`, or when the chain id or the agent address is malformed.

4.  **Run Localnet Mode:**
    Start the app pointing to your local hardhat node:
    ```sh
    bun run dev:localnet
    ```

---

## Available Scripts

### Development

- `bun run dev`: Alias for `dev:localnet`.
- `bun run dev:localnet`: Starts Vite in localnet mode (Chain ID 31337).
- `bun run dev:testnet`: Starts Vite in testnet mode (Base Sepolia).

### Production Build

- `bun run build`: **Disabled on purpose** — exits 1 and lists the modes. A bare `build` used to be mainnet mode, which made a production bundle one forgotten suffix away; always name the mode.
- `bun run build:localnet`: Builds for local environment.
- `bun run build:testnet`: Builds for Base Sepolia.
- `bun run build:mainnet`: Builds for Base Mainnet.

### Deploy (Firebase Hosting)

Each build mode has exactly one Firebase project, and the deploy scripts pin it with `--project` so the `firebase use` state on your machine never decides where a bundle lands:

| Script                   | Builds          | `--project` alias | Firebase project              | URL                                |
| ------------------------ | --------------- | ----------------- | ----------------------------- | ---------------------------------- |
| `bun run deploy:testnet` | `build:testnet` | `local`           | the testnet (sandbox) project | the sandbox project's hosting site |
| `bun run deploy:mainnet` | `build:mainnet` | `prod`            | the production project        | senseai.tradable.app               |

`.firebaserc` maps each alias to its project id and that project's `sense-ai` hosting target to its site.

`deploy:mainnet` runs `scripts/deploy-guard.ts` first and refuses unless `DEPLOY_MAINNET_CONFIRMED=1` is exported (exactly `1`; `true`/`yes` do not count):

```sh
DEPLOY_MAINNET_CONFIRMED=1 bun run deploy:mainnet
```

Both scripts deploy `--only hosting:sense-ai` (the target in `firebase.json`); nothing else in those projects is touched. The `dev` and `staging` aliases in `.firebaserc` have no deploy script — those projects are being shut down. The rules are pinned by `e2e/__guards__/deploy-targets.test.ts`.

### Utilities

- `bun run lint`: Runs ESLint.
- `bun run format`: Formats code with Prettier.
- `bun run sync-contracts`: Copies the compiled `EVMAIAgent.json`, `EVMAIAgentEscrow.json`, `SenseToken.json` and `AbleToken.json` artifacts from the sibling repositories into `src/lib/abi/` and records each one's source commit in `src/lib/abi/SOURCE.json`. Compile the sibling repositories first.
