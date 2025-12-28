# SenseAI dApp

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

- Node.js (v18 or later)
- npm

### Installation

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/TradableApp/sense-ai-dapp.git
    cd sense-ai-dapp
    ```

2.  **Install Dependencies:**

    ```sh
    npm install
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
    npm run dev:testnet
    ```
    _Note: We use `dev:testnet` here so you can interact with the app immediately using Base Sepolia. The standard `npm run dev` command requires a local blockchain node (see below)._

---

## Full Local Development Setup (Frontend + Contracts)

This guide explains how to set up the complete local environment. This is required if you want to modify smart contracts and see changes reflected in the dApp immediately.

### 1. Directory Structure

**Crucial:** The `sync-contracts` script assumes the following sibling directory structure. Ensure all three repositories are cloned into the same parent folder:

```text
.
├── able-contracts/         # The ERC-20 Token logic
├── tokenized-ai-agent/     # The Agent & Escrow logic
└── sense-ai-dapp/          # This repository
```

### 2. Start the Local Blockchain

1.  Navigate to `tokenized-ai-agent`.
2.  Start the Hardhat node:
    ```sh
    npx hardhat node
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

**Deploy Token:**

1.  Open a new terminal in `able-contracts`.
2.  Run: `npm run deploy:localnet`
3.  **Copy** the deployed `AbleToken` address.

**Deploy Agent:**

1.  Navigate to `tokenized-ai-agent`.
2.  Open `.env.base-localnet` (or create it). Set `TOKEN_CONTRACT_ADDRESS` to the address you just copied.
3.  Run: `npm run deploy:base-localnet`
4.  **Copy** the `EVMAIAgent` and `EVMAIAgentEscrow` addresses from the output.

### 5. Configure the dApp

1.  Navigate to `sense-ai-dapp`.
2.  **Sync ABIs:**
    Run the sync script to copy the latest compiled contract artifacts from the sibling directories:
    ```sh
    npm run sync-contracts
    ```
3.  **Update Addresses:**
    Open `src/config/contracts.js`. Update the `[LOCAL_CHAIN_ID]` section with the new addresses you copied in Step 4.

4.  **Run Localnet Mode:**
    Start the app pointing to your local hardhat node:
    ```sh
    npm run dev:localnet
    ```

---

## Available Scripts

### Development

- `npm run dev`: Alias for `dev:localnet`.
- `npm run dev:localnet`: Starts Vite in localnet mode (Chain ID 31337).
- `npm run dev:testnet`: Starts Vite in testnet mode (Base Sepolia).

### Production Build

- `npm run build`: Alias for `build:mainnet`.
- `npm run build:localnet`: Builds for local environment.
- `npm run build:testnet`: Builds for Base Sepolia.
- `npm run build:mainnet`: Builds for Base Mainnet.

### Utilities

- `npm run lint`: Runs ESLint.
- `npm run format`: Formats code with Prettier.
- `npm run sync-contracts`: Copies the latest `EVMAIAgent.json`, `EVMAIAgentEscrow.json`, and `AbleToken.json` artifacts from the sibling repositories into `src/lib/abi/`.
