/**
 * A stand-in for Firestore that tests drive, for the real prompts switch source. Use it from
 * a mock factory, so the module is loaded inside the factory:
 *
 *   vi.mock('firebase/firestore', async () => (await import('@/test/promptsSwitchStub')).firestoreModule);
 *   vi.mock('@/config/firebase', async () => (await import('@/test/promptsSwitchStub')).firebaseModule);
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export const ABSENT = Symbol('absent');
export const SWITCH_AGENT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
export const SWITCH_DOC_ID = `84532_${SWITCH_AGENT.toLowerCase()}`;

type Listener = {
	ref: { path: string };
	options: unknown;
	next: (_snapshot: unknown) => void;
	error: (_error: unknown) => void;
};

export const stub = {
	listeners: [] as Listener[],
	unsubscribe: vi.fn(),
	/** What `@/config/firebase` exports as `db`; undefined stands for Firestore not starting. */
	db: {} as unknown,
};

function listen(
	ref: Listener['ref'],
	options: unknown,
	next: Listener['next'],
	error: Listener['error'],
) {
	stub.listeners.push({ ref, options, next, error });
	return stub.unsubscribe;
}

export const onSnapshot = vi.fn(listen);

export const firestoreModule = {
	doc: vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` })),
	onSnapshot,
};

export const firebaseModule = {
	get db() {
		return stub.db;
	},
};

/** Fresh listeners, a started Firestore and the build's chain and agent. Call in beforeEach. */
export function resetSwitchStub(): void {
	stub.listeners = [];
	stub.db = {};
	stub.unsubscribe.mockReset();
	onSnapshot.mockReset();
	onSnapshot.mockImplementation(listen);
	vi.stubEnv('VITE_CHAIN_ID', '84532');
	vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', SWITCH_AGENT);
}

function latest(): Listener {
	const listener = stub.listeners.at(-1);
	if (!listener) throw new Error('nothing is listening');
	return listener;
}

/** The listener hears a snapshot: `ABSENT` for a document that does not exist. */
export function serverSays(data: unknown, { fromCache = false } = {}): void {
	act(() => {
		latest().next({
			exists: () => data !== ABSENT,
			data: () => (data === ABSENT ? undefined : data),
			metadata: { fromCache },
		});
	});
}

/** The listener fails with a Firestore error code, as Firestore ends it. */
export function listenerFails(code = 'permission-denied'): void {
	act(() => {
		latest().error(Object.assign(new Error('Missing or insufficient permissions.'), { code }));
	});
}
