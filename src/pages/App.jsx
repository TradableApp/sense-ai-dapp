import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAutoConnect } from 'thirdweb/react';

import ErrorBoundary from '@/components/ErrorBoundary';
import SplashScreen from '@/components/SplashScreen';
import { client, wallets } from '@/config/thirdweb';
import Auth from '@/features/auth/Auth';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import Chat from '@/features/chat/Chat';
import Error404 from '@/features/error/Error404';
import Reroute from '@/features/error/Reroute';
import History from '@/features/history/History';
import MarketPulse from '@/features/market/MarketPulse';

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
	const { status, isInitialLoading } = useAutoConnect({
		client,
		wallets,
	});

	if (!status || isInitialLoading) {
		return <SplashScreen />;
	}

	return (
		<ErrorBoundaryWrapper>
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
		</ErrorBoundaryWrapper>
	);
}
