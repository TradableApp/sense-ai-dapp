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
		{ title: 'ChainGPT: BTC Cycle', url: '#' },
	],
	[
		{ title: 'Coindesk Market Analysis', url: '#' },
		{ title: 'Bloomberg: Crypto Outlook', url: '#' },
	],
	[],
];

// --- FIX: Updated templates to include markdown examples ---
export const mockAiResponseTemplates = [
	// Simple Text Response
	"Based on my analysis of '{query}', the current outlook is positive, with on-chain metrics showing strong support.",

	// Simple Text Response
	"Regarding your question about '{query}', the data suggests a cautious approach. Social media sentiment has been trending downwards over the last 48 hours.",

	// Short Response with Markdown (List)
	"I've processed your request for '{query}'. Here are the key findings:\n\n- **Positive:** Whale accumulation is up 15%.\n- **Negative:** Social media sentiment is slightly down.\n- **Neutral:** The Fear & Greed Index remains steady.",

	// Medium Response with Markdown (Numbered List & Link)
	"My analysis of '{query}' indicates mixed signals. While on-chain data shows strong holder conviction, social media chatter is predominantly negative. \n\nHere's a quick summary:\n\n1. **On-Chain:** Net exchange flow is negative (bullish).\n2. **Social:** Mentions are up, but the sentiment score is 0.3 (bearish).\n\nFor a deeper dive, you can review the latest market report from [CoinDesk](https://www.coindesk.com).",

	// Long Response with Markdown (Table, List, Bold/Italics)
	"A comprehensive fundamental and sentiment analysis for '{query}' has been completed. The short-term outlook is volatile, but long-term fundamentals appear strong.\n\n### Key Metrics\n\n| Metric | Value | Sentiment |\n| :--- | :--- | :--- |\n| Whale Net Flow (24h) | +$15.2M | Bullish |\n| Exchange Reserves | -5% | Bullish |\n| Social Dominance | 2.1% | Neutral |\n| Fear & Greed Index | 55 | Neutral |\n\n### Summary Points:\n\n*   *Significant* whale activity suggests accumulation by large players.\n*   Decreasing exchange reserves often indicate a potential supply shock, which is bullish.\n*   Social media presence is stable but lacks strong positive or negative momentum.",
];
