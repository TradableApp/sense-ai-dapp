import { useEffect } from 'react';

import posthog from 'posthog-js';
import { useLocation } from 'react-router-dom';

function PostHogPageViewTracker() {
	const location = useLocation();

	useEffect(() => {
		if (posthog.has_opted_in_capturing && posthog.has_opted_in_capturing()) {
			posthog.capture('$pageview');
		}
	}, [location]);

	return null;
}

export default PostHogPageViewTracker;
