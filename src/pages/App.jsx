import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import cuid from 'cuid';
import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAutoConnect } from 'thirdweb/react';

import ErrorBoundary from '@/components/ErrorBoundary';
import ModalManager from '@/components/ModalManager';
import OfflineMessage from '@/components/OfflineMessage';
import SplashScreen from '@/components/SplashScreen';
import UserConsent from '@/components/UserConsent';
import { initialiseFirebaseError } from '@/config/firebase';
import { client, wallets } from '@/config/thirdweb';
import Auth from '@/features/auth/Auth';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import useNetwork from '@/hooks/useNetwork';
import { loadState, saveState } from '@/lib/browserStorage';
import { setAppError, setFirebaseReady, setThirdwebReady } from '@/store/appSlice';
import { setDeviceInfo, setDeviceScreen, setPwa } from '@/store/deviceSlice';

const UsageDashboard = lazy(() => import('@/features/usage/UsageDashboard'));
const Chat = lazy(() => import('@/features/chat/Chat'));
const History = lazy(() => import('@/features/history/History'));
const PrivacyPolicyPage = lazy(() => import('@/features/legal/PrivacyPolicyPage'));
const TermsAndConditionsPage = lazy(() => import('@/features/legal/TermsAndConditionsPage'));
const WebsiteDisclaimerPage = lazy(() => import('@/features/legal/WebsiteDisclaimerPage'));
const Error404 = lazy(() => import('@/features/error/Error404'));
const Reroute = lazy(() => import('@/features/error/Reroute'));

function ErrorBoundaryWrapper({ children }) {
	const navigate = useNavigate();
	const location = useLocation();
	return (
		<ErrorBoundary navigate={navigate} location={location}>
			{children}
		</ErrorBoundary>
	);
}

export default function App() {
	const dispatch = useDispatch();
	const appStatus = useSelector(state => state.app.status);
	const isOnline = useSelector(state => state.device.online);

	const { status: thirdwebStatus, isInitialLoading } = useAutoConnect({ client, wallets });
	const [showConsent, setShowConsent] = useState(false);

	useNetwork();

	const handleDeviceScreen = useCallback(() => {
		const { innerWidth: width, innerHeight: height } = window;
		const orientation = width > height ? 'landscape' : 'portrait';
		const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

		dispatch(
			setDeviceScreen({
				orientation,
				width,
				height,
				touch,
			}),
		);

		const isMobileScreen = Math.min(width, height) < 640;

		try {
			if (isMobileScreen && window.screen.orientation && window.screen.orientation.lock) {
				window.screen.orientation.lock('portrait');
			} else if (!isMobileScreen && window.screen.orientation && window.screen.orientation.unlock) {
				window.screen.orientation.unlock();
			}
		} catch (error) {
			console.warn('Could not lock/unlock screen orientation:', error);
		}
	}, [dispatch]);

	useEffect(() => {
		handleDeviceScreen();
		window.addEventListener('resize', handleDeviceScreen);

		return () => {
			window.removeEventListener('resize', handleDeviceScreen);
		};
	}, [handleDeviceScreen]);

	useEffect(() => {
		// Initialize Telegram Mini App
		if (window.Telegram?.WebApp) {
			const tg = window.Telegram.WebApp;
			tg.ready(); // Hides the Telegram loading spinner
			tg.expand(); // Forces the app to open to full height
			dispatch(setPwa(true)); // Treats the Telegram environment as a PWA/Native App
		}

		if (loadState('consentSettings') === null) {
			setShowConsent(true);
		}
		if (initialiseFirebaseError.error) {
			dispatch(
				setAppError(initialiseFirebaseError.error.message || 'Firebase initialization failed.'),
			);
		} else {
			dispatch(setFirebaseReady());
		}

		const getDevice = async () => {
			try {
				const DeviceDetector = (await import('device-detector-js')).default;
				const deviceDetector = new DeviceDetector();
				const deviceInfo = deviceDetector.parse(navigator.userAgent);
				const storedVisitorId = loadState('visitorId');
				const visitorId = storedVisitorId || cuid();
				if (storedVisitorId !== visitorId) {
					saveState(visitorId, 'visitorId');
				}
				const fingerprint = { visitorId };
				dispatch(setDeviceInfo({ ...deviceInfo, fingerprint }));
			} catch (error) {
				console.error('Failed to get device info:', error);
			}
		};

		getDevice();
	}, [dispatch]);

	useEffect(() => {
		if (thirdwebStatus && !isInitialLoading) {
			dispatch(setThirdwebReady());
		}
	}, [thirdwebStatus, isInitialLoading, dispatch]);

	if (appStatus === 'error') {
		return (
			<div className="flex h-screen items-center justify-center">
				<p>Error loading application. Please check your connection and refresh the page.</p>
			</div>
		);
	}

	if (appStatus !== 'ready') {
		return <SplashScreen />;
	}

	return (
		<ErrorBoundaryWrapper>
			<Suspense fallback={<SplashScreen />}>
				<Routes>
					<Route path="/auth" element={<Auth />} />
					<Route path="/error" element={<Error404 />} />
					<Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
					<Route path="/terms-and-conditions" element={<TermsAndConditionsPage />} />
					<Route path="/website-disclaimer" element={<WebsiteDisclaimerPage />} />

					<Route element={<ProtectedRoute />}>
						<Route path="/" element={<UsageDashboard />} />
						<Route path="/chat" element={<Chat />} />
						<Route path="/history" element={<History />} />
					</Route>
					<Route path="*" element={<Reroute />} />
				</Routes>
			</Suspense>

			<ModalManager />

			{showConsent && <UserConsent onConsentGiven={() => setShowConsent(false)} />}

			{!isOnline && <OfflineMessage />}
		</ErrorBoundaryWrapper>
	);
}
