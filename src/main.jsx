import { StrictMode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ThirdwebProvider } from 'thirdweb/react';

import { ThemeProvider } from '@/components/ThemeProvider';
import Toaster from '@/components/ui/sonner';
import App from '@/pages/App';

import SessionProvider from './features/auth/SessionProvider';
import store from './store/store';

import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<BrowserRouter>
			<ThirdwebProvider>
				<Provider store={store}>
					<QueryClientProvider client={queryClient}>
						<ThemeProvider defaultTheme="system" storageKey="senseai-ui-theme">
							<SessionProvider>
								<App />
								<Toaster position="bottom-right" closeButton />
							</SessionProvider>
						</ThemeProvider>
					</QueryClientProvider>
				</Provider>
			</ThirdwebProvider>
		</BrowserRouter>
	</StrictMode>,
);
