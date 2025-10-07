import { useState } from 'react';

import { setConsent } from 'firebase/analytics';
import { useDispatch } from 'react-redux';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import Label from '@/components/ui/label';
import { saveState } from '@/lib/browserStorage';
import { openModal } from '@/store/uiSlice';

export default function UserConsent({ onConsentGiven }) {
	const dispatch = useDispatch();
	const [isExpanded, setIsExpanded] = useState(false);
	const [consentChoices, setConsentChoices] = useState({
		analytics: false,
		marketing: false,
		personalization: false,
	});

	const handleChoiceChange = (key, value) => {
		setConsentChoices(prev => ({ ...prev, [key]: value }));
	};

	const handleSave = () => {
		const consentState = {
			analytics_storage: consentChoices.analytics,
			ad_storage: consentChoices.marketing,
			personalization_storage: consentChoices.personalization,
		};

		setConsent({
			analytics_storage: consentState.analytics_storage ? 'granted' : 'denied',
			ad_storage: consentState.ad_storage ? 'granted' : 'denied',
			personalization_storage: consentState.personalization_storage ? 'granted' : 'denied',
			// Essential cookies are always granted
			functionality_storage: 'granted',
			security_storage: 'granted',
		});

		saveState(consentState, 'consentSettings');
		onConsentGiven();
	};

	const handleAcceptAll = () => {
		const allConsentState = {
			analytics_storage: true,
			ad_storage: true,
			personalization_storage: true,
		};

		setConsent({
			analytics_storage: 'granted',
			ad_storage: 'granted',
			personalization_storage: 'granted',
			functionality_storage: 'granted',
			security_storage: 'granted',
		});

		saveState(allConsentState, 'consentSettings');
		onConsentGiven();
	};

	return (
		<div className="fixed bottom-4 inset-x-4 z-50 sm:left-4 sm:right-auto">
			<Card className="w-full sm:max-w-sm animate-in fade-in-0 slide-in-from-bottom-5">
				<CardHeader>
					<CardTitle>Cookie Settings</CardTitle>
					<CardDescription>
						We use cookies to enhance your experience. You can customize your preferences or accept
						all. For more details, see our{' '}
						<button
							type="button"
							className="underline"
							onClick={() => dispatch(openModal({ type: 'Privacy' }))}
						>
							Privacy Policy
						</button>
						.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isExpanded && (
						<div className="space-y-4 mb-6 animate-in fade-in-0">
							<div className="flex items-center space-x-2">
								<Checkbox id="essential" checked disabled />
								<Label htmlFor="essential">Essential Cookies</Label>
							</div>
							<div className="flex items-center space-x-2">
								<Checkbox
									id="analytics"
									checked={consentChoices.analytics}
									onCheckedChange={value => handleChoiceChange('analytics', value)}
								/>
								<Label htmlFor="analytics">Analytics Cookies</Label>
							</div>
							<div className="flex items-center space-x-2">
								<Checkbox
									id="marketing"
									checked={consentChoices.marketing}
									onCheckedChange={value => handleChoiceChange('marketing', value)}
								/>
								<Label htmlFor="marketing">Marketing Cookies</Label>
							</div>
							<div className="flex items-center space-x-2">
								<Checkbox
									id="personalization"
									checked={consentChoices.personalization}
									onCheckedChange={value => handleChoiceChange('personalization', value)}
								/>
								<Label htmlFor="personalization">Personalization Cookies</Label>
							</div>
						</div>
					)}

					<div className="flex flex-col gap-2">
						<Button className="w-full" onClick={handleAcceptAll}>
							Accept All
						</Button>
						{isExpanded ? (
							<Button className="w-full" variant="secondary" onClick={handleSave}>
								Save Preferences
							</Button>
						) : (
							<Button className="w-full" variant="secondary" onClick={() => setIsExpanded(true)}>
								Customize
							</Button>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
