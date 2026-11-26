import type { ReactNode } from 'react';

import type { Element, ElementContent } from 'hast';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import SafeLink from '@/components/ai/safe-link';
import safeHref from '@/lib/safeHref';
import remarkSafeContent from '@/lib/safeMarkdown';
import { cn } from '@/lib/utils';

/**
 * The one renderer for conversation text: the stored answer, the provisional answer from the
 * live stream and the user's own prompt. Conversation text is decrypted, so what is rendered can
 * load nothing and link nowhere unsafe, whatever the text says:
 *
 * - `remarkSafeContent` turns images into their alt text and raw HTML into text, and keeps a
 *   link only for an http or https URL;
 * - only the elements markdown writes for text are rendered (`allowedElements`); anything
 *   else is replaced by its content;
 * - `urlTransform` keeps an `href` only through `safeHref` and drops every other URL attribute;
 * - a link is a `SafeLink` (new tab, no referrer, host shown) and an image is never an element.
 *
 * The wrapper carries `ph-no-capture`, so analytics records nothing inside it.
 */

const ALLOWED_ELEMENTS = [
	'p',
	'br',
	'a',
	'em',
	'strong',
	'del',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'input',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'sup',
	'section',
];

const urlTransform: UrlTransform = (url, key) => (key === 'href' ? safeHref(url) : null);

/** A task list's checkbox is the only input markdown writes. */
const allowElement = (element: Element) =>
	element.tagName !== 'input' || element.properties.type === 'checkbox';

const textOf = (nodes: ReadonlyArray<ElementContent>): string =>
	nodes
		.map(node => {
			if (node.type === 'text') return node.value;
			return node.type === 'element' ? textOf(node.children) : '';
		})
		.join('');

/** The host a link's text names, when its text is a URL or a bare host (an autolink). */
function hostNamedBy(text: string): string | null {
	const trimmed = text.trim();
	const url = safeHref(trimmed) ?? safeHref(`http://${trimmed}`);
	return url ? new URL(url).host : null;
}

interface MarkdownLinkProps {
	href?: string;
	children?: ReactNode;
	node?: Element;
}

function MarkdownLink({ href, children, node }: MarkdownLinkProps) {
	const url = safeHref(href);
	const named = node ? hostNamedBy(textOf(node.children)) : null;
	return (
		<SafeLink href={url} showHost={!url || named !== new URL(url).host}>
			{children}
		</SafeLink>
	);
}

/** Never reached (images are text by then); an image is never an element all the same. */
function NoImage({ alt }: { alt?: string }) {
	return alt ? <span>{alt}</span> : null;
}

function InlineParagraph({ children }: { children?: ReactNode }) {
	return <p className="inline">{children}</p>;
}

const COMPONENTS: Record<'inline' | 'block', Components> = {
	inline: { a: MarkdownLink, img: NoImage, p: InlineParagraph },
	block: { a: MarkdownLink, img: NoImage },
};

interface MarkdownTextProps {
	children: string | null | undefined;
	/** An answer runs its paragraphs inline; the user's prompt keeps them as blocks. */
	paragraphs: 'inline' | 'block';
	className?: string;
}

export default function MarkdownText({ children, paragraphs, className }: MarkdownTextProps) {
	return (
		<div
			className={cn(
				'prose inherit-color prose-sm dark:prose-invert max-w-none ph-no-capture',
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkBreaks, remarkSafeContent]}
				allowedElements={ALLOWED_ELEMENTS}
				allowElement={allowElement}
				unwrapDisallowed
				urlTransform={urlTransform}
				components={COMPONENTS[paragraphs]}
			>
				{children ?? ''}
			</ReactMarkdown>
		</div>
	);
}
