// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { OFF_STACK_HOSTS, offStackHostArgs } from './off-stack-hosts';

describe('offStackHostArgs', () => {
	it('gives the localnet one resolver rule that refuses every listed host', () => {
		const args = offStackHostArgs('localnet');

		expect(args).toHaveLength(1);
		expect(args[0].startsWith('--host-resolver-rules=')).toBe(true);
		for (const host of OFF_STACK_HOSTS) {
			expect(args[0]).toContain(`MAP ${host} ~NOTFOUND`);
		}
	});

	it('gives a testnet run nothing, so the hosted build loads as a visitor loads it', () => {
		expect(offStackHostArgs('testnet')).toEqual([]);
	});

	it('refuses no host the stack or a spec needs', () => {
		// A rule is one host name, or `*.` and a domain for every name under it.
		const refuses = (rule: string, host: string) =>
			rule.startsWith('*.') ? host.endsWith(rule.slice(1)) : host === rule;
		const needed = [
			'localhost',
			'127.0.0.1',
			'firestore.googleapis.com',
			'firebase.googleapis.com',
			'firebaseinstallations.googleapis.com',
			'o1.ingest.us.sentry.io',
		];

		for (const host of needed) {
			expect(OFF_STACK_HOSTS.filter(rule => refuses(rule, host))).toEqual([]);
		}
	});
});
