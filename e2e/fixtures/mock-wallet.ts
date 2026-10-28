import { type BrowserContext, type Page } from '@playwright/test';

import { CHAIN, chainIdHex, type ChainName, getChainConfig } from '../helpers/chain';
import { exposeSigningBindings, sharedTestnetAccount } from '../testnet/bindings';

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

// Kept as its own env read rather than importing helpers/hardhat: this module only depends
// on @playwright/test and is stringified into a browser init script, so pulling in viem and
// node:child_process here would be disproportionate. It reads the SAME variable that
// sync-config.sh writes, so it cannot diverge in value from helpers/hardhat's canonical
// RPC_URL — only the fallback literal is duplicated, and both are the localnet default.
export const HARDHAT_RPC = process.env.VITE_CHAIN_RPC_URL || 'http://127.0.0.1:8545';
export const CHAIN_ID_HEX = '0x7a69'; // 31337
export const CHAIN_ID = 31337;

/** Which chain the injected wallet should claim to be on, and how it reaches it. */
export interface MockWalletChain {
	chain: ChainName;
	chainId: number;
}

/**
 * The process-wide default: whatever chain the suite is running against. Resolved per call (not
 * at import) so the config's validation error surfaces where the wallet is built, not when this
 * module is first imported by an unrelated spec.
 */
function defaultChain(): MockWalletChain {
	return CHAIN === 'localnet'
		? { chain: 'localnet', chainId: CHAIN_ID }
		: { chain: 'testnet', chainId: getChainConfig().chainId };
}

/**
 * How the page-side wallet reaches the chain.
 *
 * Localnet: `fetch` straight to the Hardhat node, which has the account unlocked or impersonated,
 * so `eth_sendTransaction` and node-side `personal_sign` work.
 *
 * Testnet: NOTHING in the browser knows where the chain is. Every call crosses a binding exposed
 * by `createWalletContext` (helpers/devices.ts): `__mockRpc` forwards reads through the chain
 * adapter (which refuses dev-node methods), `__mockSendTransaction` signs with the account's key
 * in Node and sends raw, `__mockPersonalSign` / `__mockSignTypedData` sign in Node. The private
 * provider URL therefore never enters a page, a trace or a screenshot.
 */
function transportSnippet(mode: ChainName, rpcUrl: string): string {
	if (mode === 'testnet') {
		return `
  async function rpc(method, params) {
    return window.__mockRpc(method, params || []);
  }
  async function signPersonal(message) {
    return window.__mockPersonalSign(message);
  }
  async function signTypedData(typedData) {
    return window.__mockSignTypedData(typedData);
  }
  async function sendTransaction(tx) {
    return window.__mockSendTransaction(tx);
  }`;
	}
	return `
  const RPC_URL = '${rpcUrl}';
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
  async function signPersonal(message, address) {
    // Fresh contexts expose a Node-side signer binding: derived pool
    // accounts (indices ≥ 20) are unknown to the node (impersonation
    // covers transactions only), so node-side personal_sign would fail.
    if (typeof window.__mockPersonalSign === 'function') {
      return window.__mockPersonalSign(message);
    }
    return rpc('personal_sign', [message, address || ACCOUNT]);
  }
  async function signTypedData(typedData, address) {
    return rpc('eth_signTypedData_v4', [address || ACCOUNT, typedData]);
  }
  async function sendTransaction(tx) {
    return rpc('eth_sendTransaction', [tx]);
  }`;
}

/**
 * Builds the EIP-1193 `window.ethereum` mock injected into the page before
 * navigation. On localnet it is backed by the Hardhat JSON-RPC node: signing and
 * transaction sending are delegated to the node, which has the dev accounts
 * pre-unlocked. On testnet every call crosses a Node-side binding instead (see
 * transportSnippet). Either way ThirdWeb's injected-wallet adapter connects without
 * a real extension while every on-chain interaction hits the real contracts.
 *
 * @param account The Hardhat account this wallet impersonates. Defaults to
 *   Account #1 — the legacy shared "user" wallet used by the cached-auth fixtures
 *   and the non-answer specs. Per-test fresh-user specs pass accounts 2..19 so
 *   each connects as a brand-new user (see helpers/fresh-account.ts).
 */
export function buildMockWalletScript(
	account: { address: string } = TEST_ACCOUNT,
	chain: MockWalletChain = defaultChain(),
): string {
	const chainIdHexValue = chainIdHex(chain.chainId);
	const networkVersion = String(chain.chainId);
	return `
(function() {
  // 'let' (not 'const') so an e2e test can simulate the user switching to a different
  // account in their wallet via window.__mockWalletSwitchAccount (see below).
  let ACCOUNT = '${account.address}';
  const CHAIN_ID = '${chainIdHexValue}';
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
  // (watchBlockNumber: "Failed to fetch" against the node), useContractEvents
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

${transportSnippet(chain.chain, HARDHAT_RPC)}

  const provider = {
    isMetaMask: true,
    isInjected: true,
    chainId: CHAIN_ID,
    networkVersion: '${networkVersion}',
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
          return '${networkVersion}';

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
          return signPersonal(message, address);
        }

        case 'eth_sign': {
          // Legacy raw-hash signing; treated as a personal_sign of the data (no caller uses it).
          const [address, data] = params || [];
          return signPersonal(data, address);
        }

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4': {
          const [address, typedData] = params || [];
          return signTypedData(typedData, address);
        }

        case 'eth_sendTransaction': {
          const tx = { ...(params || [])[0], from: ACCOUNT };
          return sendTransaction(tx);
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
        icon: 'data:image/svg+xml,<svg/>',
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
 * wallet. Used by the cached-auth fixtures and every non-answer spec on localnet.
 */
export const MOCK_WALLET_SCRIPT = buildMockWalletScript();

/** The shared "user" wallet for this chain: Hardhat #1 on localnet, derived index 0 on testnet
 *  (pre-funded by the runner's `fund` stage). */
export function sharedAccount(): { address: string } {
	return CHAIN === 'testnet' ? sharedTestnetAccount() : TEST_ACCOUNT;
}

async function installSharedWallet(target: Page | BrowserContext): Promise<void> {
	if (CHAIN === 'testnet') {
		const account = sharedTestnetAccount();
		await exposeSigningBindings(target, account);
		await target.addInitScript(buildMockWalletScript(account));
		return;
	}
	await target.addInitScript(MOCK_WALLET_SCRIPT);
}

/**
 * Injects the shared-user mock wallet into a Playwright Page before navigation.
 * Call this in test setup or a fixture before `page.goto()`.
 */
export async function injectMockWallet(
	page: Page,
	opts?: { seedConsent?: boolean },
): Promise<void> {
	if (opts?.seedConsent === false) {
		await page.addInitScript('window.__SEED_CONSENT__ = false;');
	}
	await installSharedWallet(page);
}

/**
 * Injects the shared-user mock wallet into all pages opened in a BrowserContext.
 * Use this for fixtures that need the mock active across navigations.
 */
export async function injectMockWalletIntoContext(context: BrowserContext): Promise<void> {
	await installSharedWallet(context);
}
