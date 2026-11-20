import { COMMUNITY_LINKS, type CommunityLink } from '@/config/communityLinks';

interface CommunityLinksNoticeProps {
	symbol: string;
	/** True when the wallet is known to hold none; otherwise it only does not hold enough. */
	hasNone: boolean;
}

function ExternalLink({ link }: { link: CommunityLink }) {
	return (
		<a
			href={link.href}
			target="_blank"
			rel="noopener noreferrer"
			className="font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			{link.label}
		</a>
	);
}

/** Points a wallet that cannot get the fee token in the app to where it can find out how. */
export default function CommunityLinksNotice({ symbol, hasNone }: CommunityLinksNoticeProps) {
	const [x, telegram] = COMMUNITY_LINKS;
	return (
		<p>
			{hasNone ? `You have no ${symbol} yet.` : `You do not have enough ${symbol}.`} Follow{' '}
			<ExternalLink link={x} /> or join <ExternalLink link={telegram} /> to find out how to get
			some.
		</p>
	);
}
