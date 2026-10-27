/**
 * Stand-in for `virtual:pwa-register/react` under vitest.
 *
 * The real module is provided by vite-plugin-pwa inside the Vite build, which vitest does
 * not run, so vitest.config.ts aliases the virtual id here. Tests that exercise the update
 * prompt mock the module with vi.mock; this inert default only keeps imports resolvable.
 */
import { useState } from 'react';

type Flag = readonly [boolean, (_value: boolean) => void];

export interface RegisterSWHook {
	needRefresh: Flag;
	offlineReady: Flag;
	updateServiceWorker: (_reloadPage?: boolean) => Promise<void>;
}

export function useRegisterSW(): RegisterSWHook {
	const [needRefresh, setNeedRefresh] = useState(false);
	const [offlineReady, setOfflineReady] = useState(false);
	return {
		needRefresh: [needRefresh, setNeedRefresh],
		offlineReady: [offlineReady, setOfflineReady],
		updateServiceWorker: () => Promise.resolve(),
	};
}
