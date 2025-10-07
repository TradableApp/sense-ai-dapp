import { useDispatch } from 'react-redux';

import { openModal } from '@/store/uiSlice';

export default function TermsAndConditionsDoc() {
	const dispatch = useDispatch();

	const openPrivacyModal = () => {
		dispatch(openModal({ type: 'Privacy' }));
	};

	const openDisclaimerModal = () => {
		dispatch(openModal({ type: 'Disclaimer' }));
	};

	return (
		<div className="prose prose-sm dark:prose-invert max-w-none">
			<h3>SenseAI – Terms and Conditions</h3>
			<p>
				<strong>Last updated:</strong> 01 March 2025
			</p>
			<hr />
			<p>
				Welcome to SenseAI. If you continue to use this decentralized application (the "dApp"), you
				agree to comply with and be bound by the following terms and conditions of use (these
				"Terms"), which together with our{' '}
				<button
					type="button"
					className="underline font-medium text-primary"
					onClick={openPrivacyModal}
				>
					Privacy Policy
				</button>{' '}
				and{' '}
				<button
					type="button"
					className="underline font-medium text-primary"
					onClick={openDisclaimerModal}
				>
					Disclaimer
				</button>
				, govern the relationship with you in relation to your use of this dApp.
			</p>
			<p>
				<strong>
					By using this dApp, you signify your acceptance of these Terms. If you do not agree, you
					must not use the dApp.
				</strong>
			</p>

			<h4>1. OUR SERVICES AND YOUR RESPONSIBILITIES</h4>
			<p>
				The dApp provides a technology interface that allows you to interact with an AI agent. All
				interactions are initiated by your connected Web3 wallet. You are solely responsible for all
				actions taken by your wallet, including initiating prompts and paying the required network
				and service fees.
			</p>

			<h4>2. NO FINANCIAL ADVICE</h4>
			<p>
				SenseAI is a tool for informational and educational purposes only. The AI's responses are
				generated algorithmically and **do not constitute financial, investment, trading, or any
				other form of advice.** You are solely responsible for your own investment decisions and any
				resulting gains or losses. You should seek advice from a licensed professional before making
				any financial decisions.
			</p>

			<h4>3. FEES AND PAYMENT</h4>
			<p>
				Interacting with the AI agent requires a service fee (the "PROMPT_FEE") paid in our
				designated utility token. This fee is secured in an on-chain escrow contract when you submit
				a prompt and is finalized upon delivery of the AI's response. You are also responsible for
				all network transaction fees (gas fees).
			</p>

			<h4>4. RISKS AND LIMITATION OF LIABILITY</h4>
			<p>
				Your use of this dApp is entirely at your own risk. The cryptocurrency market is highly
				volatile. We are not liable for any loss or damage you might suffer related to your use of
				the dApp, whether from errors in the AI's output, smart contract vulnerabilities, or any
				other use of the service.
			</p>

			<h4>5. INTELLECTUAL PROPERTY</h4>
			<p>
				This dApp and its original content, features, and functionality are owned by SenseAI and are
				protected by international copyright, trademark, and other intellectual property laws.
			</p>

			<h4>6. GOVERNING LAW</h4>
			<p>
				This agreement and these Terms are governed by and construed in accordance with the laws of
				Western Australia, Australia.
			</p>

			<p className="mt-6">© {new Date().getFullYear()} SenseAI – All rights reserved.</p>
		</div>
	);
}
