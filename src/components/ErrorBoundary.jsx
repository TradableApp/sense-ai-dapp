import React, { Component } from 'react';

import { Link } from 'react-router-dom';

import errorBotIllustration from '@/assets/react.svg'; // Placeholder illustration
import { Button } from '@/components/ui/button';

// This is the UI for the 418 "Crash" screen
function CrashDisplay() {
	return (
		<main className="min-h-screen flex items-center justify-center p-4 bg-background">
			<div className="grid md:grid-cols-2 gap-8 items-center max-w-4xl mx-auto">
				<div className="flex justify-center">
					<img
						src={errorBotIllustration}
						alt="Illustration of a robot drinking tea"
						className="w-48 h-48 md:w-64 md:h-64"
					/>
				</div>
				<div className="text-center md:text-left">
					<h1 className="text-3xl font-bold text-destructive mb-2">418 - Something went wrong</h1>
					<p className="text-muted-foreground mb-6">
						Our team has been notified of the issue. The application is still running and your funds
						remain secure. Please try refreshing or returning home.
					</p>
					<Link to="/">
						<Button>Go Back Home</Button>
					</Link>
				</div>
			</div>
		</main>
	);
}

class ErrorBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error) {
		console.error('ErrorBoundary caught an error:', error);
		return { hasError: true };
	}

	componentDidUpdate(prevProps) {
		const { location } = this.props;
		const { hasError } = this.state;

		// If the user navigates to a new page, reset the error state.
		if (hasError && prevProps.location.pathname !== location.pathname) {
			this.setState({ hasError: false });
		}
	}

	render() {
		const { hasError } = this.state;
		const { children } = this.props;

		if (hasError) {
			// If an error is caught, render the inline crash UI.
			return <CrashDisplay />;
		}

		// Otherwise, render the children as normal.
		return children;
	}
}

export default ErrorBoundary;
