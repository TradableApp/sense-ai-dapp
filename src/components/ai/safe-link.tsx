import type { ReactNode } from 'react';

import { linkHref } from '@/lib/safeHref';
import { cn } from '@/lib/utils';

interface SafeLinkProps {
	/** A URL from conversation text: a markdown link or a source. */
	href: string | null | undefined;
	children: ReactNode;
	className?: string;
	/** Classes for the text shown instead when the URL is not an http or https URL. */
	textClassName?: string;
	/** False when the link's own text already shows its URL. */
	showHost?: boolean;
}

/**
 * The only link in the conversation code. The URL becomes a link only when `linkHref` accepts it
 * (an absolute http or https URL with no user name or password, in its parsed form); anything
 * else is shown as its text, with no link. A link opens in a new tab, gives the new page no
 * handle on this one, sends no referrer and is followed by the host it leads to, as the browser
 * reads it. The link and the host are each kept apart from the direction of the text around
 * them, so the host reads the same whatever the link's text holds. The link carries no tooltip
 * (tools that name an element by its attributes would carry the URL with it) and is marked
 * `ph-no-capture`, so analytics records nothing of it.
 */
export default function SafeLink({
	href,
	children,
	className,
	textClassName,
	showHost = true,
}: SafeLinkProps) {
	const url = linkHref(href);
	if (!url) return <span className={textClassName}>{children}</span>;
	return (
		<>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer nofollow"
				referrerPolicy="no-referrer"
				className={cn('ph-no-capture [unicode-bidi:isolate]', className)}
			>
				{children}
			</a>
			{showHost && (
				<bdi
					data-link-host
					className="ml-1 text-[0.8em] font-normal text-muted-foreground no-underline"
				>
					{new URL(url).host}
				</bdi>
			)}
		</>
	);
}
