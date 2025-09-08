import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThirdwebProvider } from 'thirdweb/react';

import App from '@/pages/App';
import './index.css';

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<BrowserRouter>
			<ThirdwebProvider>
				<App />
			</ThirdwebProvider>
		</BrowserRouter>
	</StrictMode>,
);
