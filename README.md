# SenseAI dApp

This repository contains the source code for the SenseAI dApp, the primary frontend interface for the SenseAI tokenized AI agent. It is designed to be accessible both as a standalone web application and as a Telegram Mini App.

The dApp provides a seamless "Web2" user experience by leveraging the power of the ThirdWeb SDK for non-custodial wallet creation and management, allowing users to interact with the SenseAI platform with ease.

## Technology Stack

This project is built with a modern, performant stack:

- **Framework**: [React](https://react.dev/) (with [Vite](https://vitejs.dev/))
- **Web3 Provider**: [ThirdWeb SDK v5](https://thirdweb.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)

## Getting Started

To get a local copy up and running, follow these simple steps.

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

    Then, open the `.env` file and add your ThirdWeb Client ID. You can get one from the [ThirdWeb Dashboard](https://thirdweb.com/dashboard/settings/api-keys).

    ```
    VITE_THIRDWEB_CLIENT_ID="YOUR_CLIENT_ID_HERE"
    ```

4.  **Run the development server:**
    ```sh
    npm run dev
    ```
    The application will be available at `http://localhost:3002`.

## Available Scripts

- `npm run dev`: Starts the development server.
- `npm run build`: Builds the app for production.
- `npm run lint`: Lints the project files.
- `npm run preview`: Serves the production build locally for preview.
