import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import WebsiteDisclaimerDoc from './docs/WebsiteDisclaimerDoc';

export default function WebsiteDisclaimerPage() {
	return (
		<main className="min-h-screen bg-background p-4 sm:p-8">
			<div className="max-w-4xl mx-auto">
				<WebsiteDisclaimerDoc />
				<div className="mt-8 text-center">
					<Button asChild>
						<Link to="/">Return to App</Link>
					</Button>
				</div>
			</div>
		</main>
	);
}
