import { type BrowserContext, type Page } from '@playwright/test';

/**
 * Hardhat Account #1 — the "user" wallet in all E2E tests.
 * This account receives 100 ABLE in the localnet setup.
 * NEVER use this key on any real network.
 */
export const TEST_ACCOUNT = {
	address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
	privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
};

/** Hardhat Account #0 — deployer/oracle wallet */
export const DEPLOYER_ACCOUNT = {
	address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

export const HARDHAT_RPC = 'http://127.0.0.1:8545';
export const CHAIN_ID_HEX = '0x7a69'; // 31337
export const CHAIN_ID = 31337;

/**
 * Script injected into the browser page context before each navigation.
 *
 * Injects a minimal EIP-1193 compliant window.ethereum mock backed by the
 * Hardhat JSON-RPC node. All signing and transaction sending is delegated
 * to Hardhat, which has Account #1 pre-unlocked.
 *
 * This allows ThirdWeb's injected wallet adapter to connect without a real
 * browser extension, while all on-chain interactions use the real contracts.
 */
export const MOCK_WALLET_SCRIPT = `
(function() {
  const ACCOUNT = '${TEST_ACCOUNT.address}';
  const CHAIN_ID = '${CHAIN_ID_HEX}';
  const RPC_URL = '${HARDHAT_RPC}';
  let _reqId = 1;
  let _listeners = {};

  async function rpc(method, params) {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: _reqId++, method, params: params || [] }),
    });
    const json = await res.json();
    if (json.error) {
      const err = new Error(json.error.message || 'RPC error');
      err.code = json.error.code || -32603;
      throw err;
    }
    return json.result;
  }

  const provider = {
    isMetaMask: true,
    isInjected: true,
    chainId: CHAIN_ID,
    networkVersion: '31337',
    selectedAddress: ACCOUNT,
    isConnected: () => true,

    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ACCOUNT];

        case 'eth_chainId':
          return CHAIN_ID;

        case 'net_version':
          return '31337';

        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
        case 'wallet_watchAsset':
          return null;

        case 'personal_sign': {
          // params = [message, address] — Hardhat supports this for unlocked accounts
          const [message, address] = params || [];
          return rpc('personal_sign', [message, address || ACCOUNT]);
        }

        case 'eth_sign': {
          const [address, data] = params || [];
          return rpc('eth_sign', [address || ACCOUNT, data]);
        }

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4': {
          const [address, typedData] = params || [];
          return rpc('eth_signTypedData_v4', [address || ACCOUNT, typedData]);
        }

        case 'eth_sendTransaction': {
          const tx = { ...(params || [])[0], from: ACCOUNT };
          return rpc('eth_sendTransaction', [tx]);
        }

        default:
          return rpc(method, params || []);
      }
    },

    on: (event, handler) => {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(handler);
    },

    removeListener: (event, handler) => {
      if (_listeners[event]) {
        _listeners[event] = _listeners[event].filter(h => h !== handler);
      }
    },

    emit: (event, ...args) => {
      (_listeners[event] || []).forEach(h => h(...args));
    },
  };

  window.ethereum = provider;

  // Announce to ThirdWeb and other EIP-1193 listeners
  window.dispatchEvent(new Event('ethereum#initialized'));

  // EIP-6963 announcement for ThirdWeb v5 wallet detection
  const announceEvent = new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      info: {
        uuid: 'hardhat-mock-wallet',
        name: 'Hardhat Test Wallet',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        rdns: 'io.hardhat.mock',
      },
      provider,
    }),
  });
  window.dispatchEvent(announceEvent);

  // Re-announce when requested (EIP-6963)
  window.addEventListener('eip6963:requestProvider', () => {
    window.dispatchEvent(announceEvent);
  });
})();
`;

/**
 * Injects the mock wallet into a Playwright Page before navigation.
 * Call this in test setup or a fixture before `page.goto()`.
 */
export async function injectMockWallet(page: Page): Promise<void> {
	await page.addInitScript(MOCK_WALLET_SCRIPT);
}

/**
 * Injects the mock wallet into all pages opened in a BrowserContext.
 * Use this for fixtures that need the mock active across navigations.
 */
export async function injectMockWalletIntoContext(context: BrowserContext): Promise<void> {
	await context.addInitScript(MOCK_WALLET_SCRIPT);
}
