/**
 * A limit on how many async tasks run at once. Tasks start in the order they are given, each
 * as soon as a slot is free; each caller gets its own task's result or rejection, so a
 * `Promise.all` over limited tasks keeps its order and its error rules.
 *
 * Only for leaf tasks: a task that waits on another task of the same limiter can deadlock.
 */
export default function createLimiter(max: number) {
	if (!Number.isInteger(max) || max < 1) throw new RangeError('A limit must be at least 1.');
	let running = 0;
	const waiting: Array<() => void> = [];

	// A freed slot is handed straight to the next task waiting, so `running` never drops while
	// one waits: a task asked for before the waiting one resumes queues behind it.
	const release = () => {
		const next = waiting.shift();
		if (next) next();
		else running -= 1;
	};

	return async function limit<T>(task: () => Promise<T>): Promise<T> {
		if (running >= max) {
			await new Promise<void>(resolve => {
				waiting.push(resolve);
			});
		} else {
			running += 1;
		}
		try {
			return await task();
		} finally {
			release();
		}
	};
}
