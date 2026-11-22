import { describe, expect, it } from 'vitest';

import createLimiter from './limitConcurrency';

const tick = () =>
	new Promise(resolve => {
		setTimeout(resolve, 1);
	});

describe('createLimiter', () => {
	it('never runs more than its limit at once, and runs them all', async () => {
		const limit = createLimiter(3);
		let inFlight = 0;
		let mostAtOnce = 0;
		const task = (n: number) => async () => {
			inFlight += 1;
			mostAtOnce = Math.max(mostAtOnce, inFlight);
			await tick();
			inFlight -= 1;
			return n;
		};

		const results = await Promise.all(Array.from({ length: 20 }, (_, n) => limit(task(n))));

		expect(mostAtOnce).toBe(3);
		expect(results).toEqual(Array.from({ length: 20 }, (_, n) => n));
	});

	it('passes a rejection to its caller and frees the slot for the rest', async () => {
		const limit = createLimiter(1);
		const failed = limit(async () => {
			throw new Error('boom');
		});
		const next = limit(async () => 'next');

		await expect(failed).rejects.toThrow('boom');
		await expect(next).resolves.toBe('next');
	});

	it('refuses a limit below one', () => {
		expect(() => createLimiter(0)).toThrow(RangeError);
	});
});
