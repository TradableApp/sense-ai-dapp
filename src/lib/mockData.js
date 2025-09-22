// This file acts as a stateless pool of mock content for the API to pull from.

export const mockReasoningPool = [
	[
		{
			title: 'Examining the Root Cause',
			description:
				'The user has provided a short query. I need to first understand the core intent before formulating a response.',
		},
		{
			title: 'Pinpointing the Rationale',
			description:
				'The context is minimal, so I will assume it is a conversational opening and prepare a polite and open-ended response.',
		},
		{
			title: 'Refining the Aesthetic Rationale',
			description:
				'The key finding is that the system is ready to help. I will structure the final response to clearly communicate this.',
		},
	],
	[
		{
			title: 'Deconstructing the Request',
			description:
				'The query revolves around market sentiment for a specific asset. This requires accessing multiple data sources.',
		},
		{
			title: 'Synthesizing Data Points',
			description:
				'I am cross-referencing on-chain data from Glassnode with social media sentiment trends to determine market direction.',
		},
		{
			title: 'Elaborating on Contrast',
			description:
				'The Fear & Greed Index is showing "Neutral", but whale transaction volume indicates accumulation. The final answer must reflect this nuance.',
		},
		{
			title: 'Finalizing the Conclusion',
			description:
				'The overall sentiment is cautiously optimistic, but I will include a caveat about market volatility.',
		},
	],
	[
		{
			title: 'Identifying Core Concepts',
			description:
				'The user is asking about a specific Ethereum Improvement Proposal (EIP). I will access my knowledge base for EIPs.',
		},
		{
			title: 'Gathering Key Information',
			description:
				'Sourcing data from the official EIP repository and recent developer consensus call notes to ensure accuracy.',
		},
	],
];

export const mockSourcesPool = [
	[{ title: 'Alternative.me: Fear & Greed Index', url: '#' }],
	[
		{ title: 'EIP-7702 Proposal Details', url: '#' },
		{ title: 'Glassnode: On-Chain Metrics', url: '#' },
	],
	[{ title: 'Coindesk Market Analysis', url: '#' }],
	[],
];

export const mockAiResponseTemplates = [
	"Based on my analysis of '{query}', the current outlook is positive.",
	"Regarding your question about '{query}', the data suggests a cautious approach.",
	"I've processed your request for '{query}'. Here are the key findings.",
];
