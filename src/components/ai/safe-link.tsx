import type { ReactNode } from 'react';

import safeHref from '@/lib/safeHref';

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
 * The only link in the conversation code. The URL becomes a link only when `safeHref` accepts it
 * (an absolute http or https URL, in its parsed form); anything else is shown as its text, with
 * no link. A link opens in a new tab, gives the new page no handle on this one, sends no
 * referrer, carries its full URL as its tooltip and is followed by the host it leads to.
 */
export default function SafeLink({
	href,
	children,
	className,
	textClassName,
	showHost = true,
}: SafeLinkProps) {
	const url = safeHref(href);
	if (!url) return <span className={textClassName}>{children}</span>;
	return (
		<>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer nofollow"
				referrerPolicy="no-referrer"
				title={url}
				className={className}
			>
				{children}
			</a>
			{showHost && (
				<span
					data-link-host
					className="ml-1 text-[0.8em] font-normal text-muted-foreground no-underline"
				>
					{new URL(url).host}
				</span>
			)}
		</>
	);
}
