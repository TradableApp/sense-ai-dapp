import { StrictMode } from 'react';

import { PostHogProvider } from '@posthog/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ThirdwebProvider } from 'thirdweb/react';

import PostHogPageViewTracker from '@/components/PostHogPageViewTracker';
import { ThemeProvider } from '@/components/ThemeProvider';
import Toaster from '@/components/ui/sonner';
import { initPosthog } from '@/config/posthog';
import App from '@/pages/App';

import SessionProvider from './features/auth/SessionProvider';
import store from './store/store';
import './index.css';

// Initialize PostHog before render
initPosthog();

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<BrowserRouter>
			<ThirdwebProvider>
				<Provider store={store}>
					<QueryClientProvider client={queryClient}>
						<PostHogProvider client={posthog}>
							<ThemeProvider defaultTheme="system" storageKey="senseai-ui-theme">
								<SessionProvider>
									{/* Tracker goes inside Router but outside Routes */}
									<PostHogPageViewTracker />
									<App />
									<Toaster position="bottom-right" closeButton />
								</SessionProvider>
							</ThemeProvider>
						</PostHogProvider>
					</QueryClientProvider>
				</Provider>
			</ThirdwebProvider>
		</BrowserRouter>
	</StrictMode>,
);
