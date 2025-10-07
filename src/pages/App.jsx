import { lazy, Suspense, useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAutoConnect } from 'thirdweb/react';

import ErrorBoundary from '@/components/ErrorBoundary';
import ModalManager from '@/components/ModalManager';
import SplashScreen from '@/components/SplashScreen';
import UserConsent from '@/components/UserConsent';
import { initialiseFirebaseError } from '@/config/firebase';
import { client, wallets } from '@/config/thirdweb';
import Auth from '@/features/auth/Auth';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import { loadState } from '@/lib/browserStorage';
import { setAppError, setFirebaseReady, setThirdwebReady } from '@/store/appSlice';

const MarketPulse = lazy(() => import('@/features/market/MarketPulse'));
const Chat = lazy(() => import('@/features/chat/Chat'));
const History = lazy(() => import('@/features/history/History'));
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
	const { status: thirdwebStatus, isInitialLoading } = useAutoConnect({ client, wallets });
	const [showConsent, setShowConsent] = useState(false);

	useEffect(() => {
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
			{/* The <Suspense> component shows a fallback UI while lazy-loaded components are fetched. */}
			<Suspense fallback={<SplashScreen />}>
				<Routes>
					<Route path="/auth" element={<Auth />} />
					<Route path="/error" element={<Error404 />} />
					<Route element={<ProtectedRoute />}>
						<Route path="/" element={<MarketPulse />} />
						<Route path="/chat" element={<Chat />} />
						<Route path="/history" element={<History />} />
					</Route>
					<Route path="*" element={<Reroute />} />
				</Routes>
			</Suspense>

			<ModalManager />

			{showConsent && <UserConsent onConsentGiven={() => setShowConsent(false)} />}
		</ErrorBoundaryWrapper>
	);
}
