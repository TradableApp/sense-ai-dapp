# SenseAI dApp

This repository contains the source code for the SenseAI dApp, the primary frontend interface for the SenseAI tokenized AI agent. It is designed to be accessible both as a standalone web application and as a Telegram Mini App.

The dApp provides a seamless "Web2" user experience by leveraging the power of the Thirdweb SDK for non-custodial wallet creation and management, allowing users to interact with the SenseAI platform with ease.

## Technology Stack

This project is built with a modern, performant stack:

- **Framework**: [React](https://react.dev/) (with [Vite](https://vitejs.dev/))
- **Web3 Provider**: [Thirdweb SDK v5](https://thirdweb.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)

## Getting Started (Frontend Only)

To get a local copy of just the frontend UI running, follow these simple steps. For a full local development setup that includes smart contract interaction, see the **Full Local Development Setup** section below.

### Prerequisites

- Node.js (v18 or later)
- npm

### Installation

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/your-username/sense-ai-dapp.git
    cd sense-ai-dapp
    ```

2.  **Install NPM packages:**

    ```sh
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project by copying the example file:

    ```sh
    cp .env.example .env
    ```

    Then, open the `.env` file and add your Thirdweb Client ID. You can get one from the [Thirdweb Dashboard](https://thirdweb.com/dashboard/settings/api-keys).

    ```
    VITE_THIRDWEB_CLIENT_ID="YOUR_CLIENT_ID_HERE"
    ```

4.  **Run the development server:**
    ```sh
    npm run dev
    ```
    The application will be available at `http://localhost:3002`.

---

## Full Local Development Setup (Frontend + Contracts)

This guide explains how to set up a complete local development environment, including a local blockchain, deployed smart contracts, and a secure development wallet.

This guide assumes you have cloned all three repositories (`sense-ai-dapp`, `tokenized-ai-agent`, `able-contracts`) into a common parent directory.

### Part 1: Start the Local Blockchain

1.  Open a new terminal and navigate to the `tokenized-ai-agent` repository.
2.  Run the following command to start a local Hardhat node:
    ```sh
    npx hardhat node
    ```
    This will start a local blockchain at `http://127.0.0.1:8545` and provide a list of 20 pre-funded test accounts. **Leave this terminal window running.**

### Part 2: Create a Secure Dev Wallet

For security, **never** import publicly-known private keys (like the ones from Hardhat) into your primary MetaMask wallet. Instead, create an isolated development environment using a separate browser profile.

1.  **Create a New Browser Profile:** In your browser (Chrome, Brave, etc.), go to Settings -> Profiles and create a new profile named "Web3 Dev".
2.  **Install MetaMask:** In the new "Web3 Dev" browser window, install a fresh MetaMask extension.
3.  **Create a Disposable Wallet:** When MetaMask starts, select **"Create a new wallet"**.
    - **IMPORTANT:** You do **not** need to save the Secret Recovery Phrase for this wallet. It is disposable and should never hold real funds. Choose to "Remind me later" when prompted to secure it.
4.  **Import Hardhat Account:**
    - In your new MetaMask, click the account dropdown, then **Add wallet -> Import account**.
    - Copy the **Private Key** for `Account #0` from the Hardhat node terminal.
    - Paste the key into MetaMask and click "Import". You should now see an account with a balance of 10000 ETH. Rename this account to "Hardhat #0" for clarity.

### Part 3: Deploy Smart Contracts

1.  **Deploy `AbleToken`:**

    - Open a new terminal and navigate to your `able-contracts` repository.
    - Run the local deployment script:
      ```sh
      npm run deploy:localnet
      ```
    - The script will output the deployed `AbleToken` proxy address. **Copy this address.**

2.  **Deploy Agent & Escrow Contracts:**
    - Navigate to your `tokenized-ai-agent` repository.
    - Open the `.env.base-localnet` file. Paste the `AbleToken` address you just copied as the value for `TOKEN_CONTRACT_ADDRESS`.
    - Run the local deployment script:
      ```sh
      npm run deploy:base-localnet
      ```
    - The script will output the deployed `EVMAIAgent` and `EVMAIAgentEscrow` addresses. **Copy both of these addresses.**

### Part 4: Configure and Run the dApp

1.  **Navigate to the dApp:**

    - Navigate to your `sense-ai-dapp` repository.

2.  **Sync Contract ABIs:**

    - Run the sync script to copy the latest contract interfaces into the project. This ensures the frontend knows how to communicate with the smart contracts you just deployed.
      ```sh
      npm run sync-contracts
      ```

3.  **Update Frontend Config:**

    - Open the `src/config/contracts.js` file.
    - Paste the three contract addresses you have copied into the `[LOCAL_CHAIN_ID]` section.

4.  **Run the dApp:**

    - Follow the steps in the "Getting Started" section to install dependencies and set up your `.env` file (if you haven't already).
    - Start the development server:
      ```sh
      npm run dev
      ```

5.  **Connect Your Wallet:**
    - Open the dApp in your "Web3 Dev" browser profile.
    - Click "Connect Wallet". The dApp will prompt you to add and switch to the "Hardhat Localnet" (Chain ID 31337). Approve this in MetaMask.
    - Connect your "Hardhat #0" account.

You should now see the application's onboarding flow, fully connected to your local smart contracts.

## Available Scripts

- `npm run dev`: Starts the development server.
- `npm run build`: Builds the app for production.
- `npm run lint`: Lints the project files.
- `npm run preview`: Serves the production build locally for preview.
- `npm run sync-contracts`: Copies the latest contract ABIs from the `tokenized-ai-agent` and `able-contracts` repositories into the frontend project.
