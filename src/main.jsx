import { StrictMode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ThirdwebProvider } from 'thirdweb/react';

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
						<SessionProvider>
							<App />
						</SessionProvider>
					</QueryClientProvider>
				</Provider>
			</ThirdwebProvider>
		</BrowserRouter>
	</StrictMode>,
);
