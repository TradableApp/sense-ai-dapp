export type FaucetOutcome =
	| { kind: 'received'; amount: string }
	| { kind: 'reverted' }
	| { kind: 'no-transfer' }
	| { kind: 'timeout' };

export interface FaucetNotice {
	tone: 'success' | 'error' | 'info';
	title: string;
	description: string;
}

export function faucetOutcome(_receipt: unknown, _expected: unknown): FaucetOutcome {
	return { kind: 'timeout' };
}

export function faucetNotice(_outcome: FaucetOutcome, _symbol: string): FaucetNotice {
	return { tone: 'info', title: '', description: '' };
}
