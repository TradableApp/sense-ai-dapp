import { Link } from 'react-router-dom';

import notFoundIllustration from '@/assets/react.svg'; // Placeholder illustration
import { Button } from '@/components/ui/button';

export default function Error404() {
	return (
		<main className="min-h-screen flex items-center justify-center p-4 bg-background">
			<div className="grid md:grid-cols-2 gap-8 items-center max-w-4xl mx-auto">
				<div className="flex justify-center">
					<img
						src={notFoundIllustration}
						alt="Illustration of a person looking at a map"
						className="w-48 h-48 md:w-64 md:h-64"
					/>
				</div>
				<div className="text-center md:text-left">
					<h1 className="text-3xl font-bold text-primary mb-2">404 - Wrong Galaxy</h1>
					<h2 className="text-xl font-semibold mb-4">
						The page you're after has drifted off-course!
					</h2>
					<p className="text-muted-foreground mb-6">
						If you think this is a mistake, feel free to contact our support team.
					</p>
					<Link to="/">
						<Button>Go Back Home</Button>
					</Link>
				</div>
			</div>
		</main>
	);
}
