import { useCallback, useEffect, useRef } from 'react';

import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebase';
import { wait } from '@/lib/utils';
import { setLatestIP, setOnline } from '@/store/deviceSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store/store';

const getRequestIP = functions ? httpsCallable(functions, 'getRequestIP') : null;

export default function useNetwork(): void {
	const dispatch = useAppDispatch();
	const isOnline = useAppSelector((state: RootState) => state.device.online);
	const latestIP = useAppSelector((state: RootState) => state.device.latestIP);

	const webPingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const handleConnectionChange = useCallback(() => {
		const sendWebPing = async () => {
			try {
				await fetch('https://www.google.com/images/errors/robot.png', {
					method: 'HEAD',
					mode: 'no-cors',
					cache: 'no-cache',
				});

				if (!isOnline) {
					console.log('[useNetwork] Internet connection re-established.');
					dispatch(setOnline(true));
				}

				// Clear the interval if we are online.
				if (webPingRef.current) clearInterval(webPingRef.current);

				// Now that we're online, fetch the IP address.
				try {
					if (getRequestIP) {
						const ipResponse = await getRequestIP();
						const newIP = (ipResponse?.data as any)?.ip;
						if (newIP && newIP !== latestIP) {
							dispatch(setLatestIP(newIP));
						}
					}
				} catch (error) {
					console.warn('[useNetwork] Could not fetch IP address:', error);
				}
			} catch (error) {
				if (isOnline) {
					console.log('[useNetwork] Internet connection lost.');
					dispatch(setOnline(false));
					if (latestIP) {
						dispatch(setLatestIP(null));
					}
				}
			}
		};

		// On connection change, wait 5s then start pinging every 5 seconds until a connection is confirmed.
		wait(5000).then(() => {
			if (webPingRef.current) clearInterval(webPingRef.current);
			sendWebPing(); // Run immediately
			webPingRef.current = setInterval(sendWebPing, 5000);
		});
	}, [dispatch, isOnline, latestIP]);

	useEffect(() => {
		handleConnectionChange(); // Run on mount

		window.addEventListener('online', handleConnectionChange);
		window.addEventListener('offline', handleConnectionChange);
		window.addEventListener('focus', handleConnectionChange);

		return () => {
			window.removeEventListener('online', handleConnectionChange);
			window.removeEventListener('offline', handleConnectionChange);
			window.removeEventListener('focus', handleConnectionChange);
			if (webPingRef.current) clearInterval(webPingRef.current);
		};
	}, [handleConnectionChange]);
}
