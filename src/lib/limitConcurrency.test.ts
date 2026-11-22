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

	// A slot freed by one task goes to the next one waiting: a task asked for in the moment
	// between the two must queue behind it, not take the slot as well. That moment is a few
	// microtasks long, so every offset into it is tried.
	it('gives a freed slot to the task waiting, not to one asked for meanwhile', async () => {
		for (let offset = 0; offset < 8; offset += 1) {
			const limit = createLimiter(1);
			let inFlight = 0;
			let mostAtOnce = 0;
			const tracked = async () => {
				inFlight += 1;
				mostAtOnce = Math.max(mostAtOnce, inFlight);
				await tick();
				inFlight -= 1;
			};
			let finishFirst = () => {};
			const first = limit(
				() =>
					new Promise<void>(resolve => {
						finishFirst = resolve;
					}),
			);
			const waiting = limit(tracked);
			finishFirst();
			for (let i = 0; i < offset; i += 1) {
				// eslint-disable-next-line no-await-in-loop -- each step is one microtask
				await Promise.resolve();
			}
			const late = limit(tracked);
			// eslint-disable-next-line no-await-in-loop -- one offset at a time
			await Promise.all([first, waiting, late]);

			expect({ offset, mostAtOnce }).toEqual({ offset, mostAtOnce: 1 });
		}
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
