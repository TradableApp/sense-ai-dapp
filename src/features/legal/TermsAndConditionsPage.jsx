import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import TermsAndConditionsDoc from './docs/TermsAndConditionsDoc';

export default function TermsAndConditionsPage() {
	return (
		<main className="min-h-screen bg-background p-4 sm:p-8">
			<div className="max-w-4xl mx-auto">
				<TermsAndConditionsDoc />
				<div className="mt-8 text-center">
					<Button asChild>
						<Link to="/">Return to App</Link>
					</Button>
				</div>
			</div>
		</main>
	);
}
