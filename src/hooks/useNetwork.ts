import { useCallback, useEffect, useRef } from 'react';

import { httpsCallable } from 'firebase/functions';
import { useDispatch, useSelector } from 'react-redux';

import { functions } from '@/config/firebase';
import { wait } from '@/lib/utils';
import { setLatestIP, setOnline } from '@/store/deviceSlice';

const getRequestIP = httpsCallable(functions, 'getRequestIP');

export default function useNetwork() {
	const dispatch = useDispatch();
	const isOnline = useSelector(state => state.device.online);
	const latestIP = useSelector(state => state.device.latestIP);

	const webPingRef = useRef(null);

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
					const ipResponse = await getRequestIP();
					const newIP = ipResponse?.data?.ip;
					if (newIP && newIP !== latestIP) {
						dispatch(setLatestIP(newIP));
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
