/**
 * Where SenseAI talks to its users. Shown to a wallet with none of a fee token that cannot
 * be got in the app, so it can find out how the token is obtained. Kept here, not in a
 * component, so every place that shows them shows the same.
 */
export interface CommunityLink {
	/** The link's text, read in a sentence: "Follow <label> or join <label> …". */
	label: string;
	href: string;
}

export const COMMUNITY_LINKS: readonly [CommunityLink, CommunityLink] = [
	{ label: 'SenseAI on X', href: 'https://x.com/SenseAI_agent' },
	{ label: 'the SenseAI Telegram group', href: 'https://t.me/tradable_community' },
];
