import { getAnalytics, isSupported as isAnalyticsSupported, setConsent } from 'firebase/analytics';
import type { Analytics } from 'firebase/analytics';
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type { AppCheck } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import { getPerformance } from 'firebase/performance';
import type { FirebasePerformance } from 'firebase/performance';

import { loadState } from '@/lib/browserStorage';

const firebaseConfig = {
	apiKey: import.meta.env.VITE_API_KEY,
	authDomain: import.meta.env.VITE_AUTH_DOMAIN,
	databaseURL: import.meta.env.VITE_DATABASE_URL,
	projectId: import.meta.env.VITE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_APP_ID,
	measurementId: import.meta.env.VITE_MEASUREMENT_ID,
};

// Some browsers have compatibility issues with GCP functions, so perform initialisation within try-catch block
const initialiseFirebase = () => {
	let firebaseApp: FirebaseApp | undefined;
	const firebaseExports: {
		analytics: Analytics | undefined;
		appCheck: AppCheck | undefined;
		db: Firestore | undefined;
		functions: Functions | undefined;
		perf: FirebasePerformance | undefined;
	} = {
		analytics: undefined,
		appCheck: undefined,
		db: undefined,
		functions: undefined,
		perf: undefined,
	};
	let initialiseFirebaseError: Record<string, unknown> = {};
	try {
		firebaseApp = initializeApp(firebaseConfig);

		if (import.meta.env.DEV || import.meta.env.VITE_APP_DEBUG) {
			(window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
				import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN;
		}

		// Initialize App Check to protect backend resources
		const appCheck = initializeAppCheck(firebaseApp, {
			provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
			// Optional argument. If true, the SDK automatically refreshes App Check
			// tokens as needed.
			isTokenAutoRefreshEnabled: true,
		});
		firebaseExports.appCheck = appCheck;

		// Initialize Analytics and get a reference to the service
		if (typeof window !== 'undefined') {
			isAnalyticsSupported().then(supported => {
				if (supported && import.meta.env.VITE_MEASUREMENT_ID && firebaseApp) {
					const analytics = getAnalytics(firebaseApp);
					firebaseExports.analytics = analytics;
				}
			});
		}

		// Check if consent has been provided previously by the user
		const consentSettings = (loadState('consentSettings') || {}) as Record<string, unknown>;

		const {
			ad_storage: marketingStorage,
			analytics_storage: analyticsStorage,
			personalization_storage: personalisationsStorage,
		} = consentSettings;

		// Disable Analytics collection and set consent to defaults until we have consent from the user
		setConsent({
			/* V1 */
			ad_storage: marketingStorage ? 'granted' : 'denied', // Related to advertising
			analytics_storage: analyticsStorage ? 'granted' : 'denied', // Related to analytics (e.g., visit duration)
			functionality_storage: 'granted', // Related to website or app functionality (e.g., language settings)
			personalization_storage: personalisationsStorage ? 'granted' : 'denied', // Related to personalization (e.g., video recommendations)
			security_storage: 'granted', // Related to security (e.g., authentication, fraud prevention, and user protection)
			/* V2 */
			ad_user_data: marketingStorage ? 'granted' : 'denied', // Related to advertising
			ad_personalization: personalisationsStorage ? 'granted' : 'denied', // Related to advertising
		});

		// Initialize Performance Monitoring and get a reference to the service
		const perf = getPerformance(firebaseApp);
		firebaseExports.perf = perf;

		// Initialize Cloud Firestore and get a reference to the service
		const db = getFirestore(firebaseApp);
		firebaseExports.db = db;

		// Initialize an instance of Cloud Functions and get a reference to the service
		const functions = getFunctions(firebaseApp);
		firebaseExports.functions = functions;

		console.log('[Firebase] Initialization successful.');
	} catch (error) {
		console.error('initialiseFirebase error', error);

		initialiseFirebaseError = {
			error,
			missingFunctionality: Object.keys(firebaseExports).filter(
				key => !firebaseExports[key as keyof typeof firebaseExports],
			),
		};
	}

	return {
		firebaseApp,
		firebaseExports,
		initialiseFirebaseError,
	};
};

const {
	firebaseApp,
	firebaseExports: { analytics, appCheck, db, functions, perf },
	initialiseFirebaseError,
} = initialiseFirebase();

export { analytics, appCheck, db, functions, initialiseFirebaseError, perf };

export default firebaseApp;
