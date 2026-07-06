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
 * Builds the EIP-1193 `window.ethereum` mock injected into the page before
 * navigation, backed by the Hardhat JSON-RPC node. All signing and transaction
 * sending is delegated to Hardhat, which has the dev accounts pre-unlocked, so
 * ThirdWeb's injected-wallet adapter can connect without a real extension while
 * every on-chain interaction hits the real contracts.
 *
 * @param account The Hardhat account this wallet impersonates. Defaults to
 *   Account #1 — the legacy shared "user" wallet used by the cached-auth fixtures
 *   and the non-answer specs. Per-test fresh-user specs pass accounts 2..19 so
 *   each connects as a brand-new user (see helpers/fresh-account.ts).
 */
export function buildMockWalletScript(account: { address: string } = TEST_ACCOUNT): string {
	return `
(function() {
  // 'let' (not 'const') so an e2e test can simulate the user switching to a different
  // account in their wallet via window.__mockWalletSwitchAccount (see below).
  let ACCOUNT = '${account.address}';
  const CHAIN_ID = '${CHAIN_ID_HEX}';
  const RPC_URL = '${HARDHAT_RPC}';
  let _reqId = 1;
  let _listeners = {};
  let _announced = false;

  function _dispatch(event, ...args) {
    (_listeners[event] || []).forEach(h => h(...args));
  }

  // A real injected wallet emits connect → chainChanged → accountsChanged right
  // after the user approves the connection. ThirdWeb v5's injected adapter relies
  // on these to finalise the chain object; without them a mid-session fresh
  // connect leaves the chain half-initialised, the RPC block watcher never starts
  // (watchBlockNumber: "Failed to fetch 127.0.0.1:8545"), useContractEvents
  // returns undefined, and the answer pipeline never syncs. Fire them once.
  function announceConnection() {
    if (_announced) return;
    _announced = true;
    _dispatch('connect', { chainId: CHAIN_ID });
    _dispatch('chainChanged', CHAIN_ID);
    _dispatch('accountsChanged', [ACCOUNT]);
  }

  // Pre-seed cookie consent so the consent dialog (shown when
  // localStorage.consentSettings === null) never appears and gates the page /
  // blocks the ThirdWeb connect modal during E2E. The consent specs themselves
  // (T-UI-16..18) opt out via injectMockWallet(page, { seedConsent: false }) —
  // this seeding runs AFTER any spec-level localStorage.clear() init script and
  // would otherwise make the banner untestable.
  try {
    if (window.__SEED_CONSENT__ !== false && window.localStorage.getItem('consentSettings') === null) {
      window.localStorage.setItem(
        'consentSettings',
        JSON.stringify({ analytics_storage: true, ad_storage: true, personalization_storage: true }),
      );
    }
  } catch (e) {
    // localStorage can be unavailable under restrictive CSP / storage partitioning
    // in some CI sandboxes. Surface it in Playwright's browser-console capture
    // rather than swallowing — a silent failure here lets the consent dialog
    // reappear and mysteriously block the ThirdWeb connect modal downstream.
    console.warn('[mock-wallet] Could not pre-seed consentSettings:', e);
  }

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
          // Explicit connect (the fresh-connect path). Announce after this
          // resolves (setTimeout 0) so ThirdWeb's adapter has already attached its
          // connect/chainChanged/accountsChanged listeners before we fire them.
          setTimeout(announceConnection, 0);
          return [ACCOUNT];

        case 'eth_accounts':
          // Silent read (autoConnect path) — never triggers the connect events.
          return [ACCOUNT];

        case 'eth_chainId':
          return CHAIN_ID;

        case 'net_version':
          return '31337';

        case 'wallet_switchEthereumChain':
          // Confirm the switch, then notify listeners as a real wallet would.
          setTimeout(() => _dispatch('chainChanged', CHAIN_ID), 0);
          return null;

        case 'wallet_addEthereumChain':
        case 'wallet_watchAsset':
          return null;

        case 'personal_sign': {
          // params = [message, address] — Hardhat supports this for unlocked accounts
          const [message, address] = params || [];
          // E2E only: an optional window.__mockSignDelayMs holds the signing/deriving screen
          // visible long enough for a test to assert it (the mock otherwise signs near-instantly
          // via Hardhat, so the screen would flash by before an assertion can catch it).
          if (typeof window.__mockSignDelayMs === 'number' && window.__mockSignDelayMs > 0) {
            await new Promise(r => setTimeout(r, window.__mockSignDelayMs));
          }
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

  // E2E only: simulate the user switching to a different account in the SAME wallet/device.
  // Updates the active account and fires accountsChanged, exactly as a real injected wallet
  // does — letting a test verify per-wallet data isolation on one shared browser/IndexedDB.
  window.__mockWalletSwitchAccount = function (newAddress) {
    ACCOUNT = newAddress;
    provider.selectedAddress = newAddress;
    _dispatch('accountsChanged', [newAddress]);
  };

  // Announce to ThirdWeb and other EIP-1193 listeners
  window.dispatchEvent(new Event('ethereum#initialized'));

  // EIP-6963 announcement for ThirdWeb v5 wallet detection
  const announceEvent = new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      // Impersonate MetaMask so the dApp's configured createWallet('io.metamask')
      // detects this mock as an installed injected wallet and connects to it.
      // (ThirdWeb v5 only surfaces EIP-6963 wallets whose rdns is configured.)
      info: {
        uuid: 'hardhat-mock-wallet',
        name: 'MetaMask',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        rdns: 'io.metamask',
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
}

/**
 * The default mock wallet script — Hardhat Account #1, the legacy shared "user"
 * wallet. Used by the cached-auth fixtures and every non-answer spec.
 */
export const MOCK_WALLET_SCRIPT = buildMockWalletScript();

/**
 * Injects the mock wallet into a Playwright Page before navigation.
 * Call this in test setup or a fixture before `page.goto()`.
 */
export async function injectMockWallet(
	page: Page,
	opts?: { seedConsent?: boolean },
): Promise<void> {
	if (opts?.seedConsent === false) {
		await page.addInitScript('window.__SEED_CONSENT__ = false;');
	}
	await page.addInitScript(MOCK_WALLET_SCRIPT);
}

/**
 * Injects the mock wallet into all pages opened in a BrowserContext.
 * Use this for fixtures that need the mock active across navigations.
 */
export async function injectMockWalletIntoContext(context: BrowserContext): Promise<void> {
	await context.addInitScript(MOCK_WALLET_SCRIPT);
}
