import { Component, type ReactNode } from 'react';

import type { Element, ElementContent } from 'hast';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import SafeLink from '@/components/ai/safe-link';
import { linkHref, textShowsHost } from '@/lib/safeHref';
import remarkSafeContent from '@/lib/safeMarkdown';
import { cn } from '@/lib/utils';

import { isNestedTooDeep } from './markdownDepth';

/**
 * The one renderer for conversation text: the stored answer, the provisional answer from the
 * live stream and the user's own prompt. Conversation text is decrypted, so what is rendered can
 * load nothing and link nowhere unsafe, whatever the text says:
 *
 * - `remarkSafeContent` turns images into their alt text and raw HTML into text, and keeps a
 *   link only for an http or https URL;
 * - only the elements markdown writes for text are rendered (`allowedElements`); anything
 *   else is replaced by its content;
 * - `urlTransform` keeps an `href` only through `linkHref` and drops every other URL attribute;
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

const urlTransform: UrlTransform = (url, key) => (key === 'href' ? linkHref(url) : null);

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

interface MarkdownLinkProps {
	href?: string;
	children?: ReactNode;
	node?: Element;
}

function MarkdownLink({ href, children, node }: MarkdownLinkProps) {
	// Checked again here and in SafeLink, though urlTransform has already been through it: each
	// layer holds the rule itself, so none depends on which caller it has.
	const url = linkHref(href);
	// The host is left out only after text that already shows it, as written (an autolink).
	const shown = !!url && !!node && textShowsHost(textOf(node.children), url);
	return (
		<SafeLink href={url} showHost={!shown}>
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

interface PlainTextFallbackProps {
	text: string;
	children: ReactNode;
}

/**
 * Shows the text as it was written when rendering it as markdown throws (text nested deeper
 * than the parser or the renderer can follow), so one message cannot take the page down with
 * it. Text nested past `MAX_NESTING` never gets this far: `MarkdownText` shows it plain itself. Given a `key` of the text by its caller, so other text is tried afresh.
 */
export class PlainTextFallback extends Component<PlainTextFallbackProps, { failed: boolean }> {
	constructor(props: PlainTextFallbackProps) {
		super(props);
		this.state = { failed: false };
	}

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown) {
		// The name only: the message of a parser's error can quote the text.
		console.error(
			'[markdown] Text shown plain; it could not be rendered:',
			error instanceof Error ? error.name : typeof error,
		);
	}

	render() {
		const { text, children } = this.props;
		const { failed } = this.state;
		return failed ? (
			<span data-markdown-fallback className="whitespace-pre-wrap break-words">
				{text}
			</span>
		) : (
			children
		);
	}
}

interface MarkdownTextProps {
	children: string | null | undefined;
	/** An answer runs its paragraphs inline; the user's prompt keeps them as blocks. */
	paragraphs: 'inline' | 'block';
	className?: string;
}

export default function MarkdownText({ children, paragraphs, className }: MarkdownTextProps) {
	const text = children ?? '';
	// Not attempted: the renderer would spend seconds on it before it gave up.
	if (isNestedTooDeep(text)) {
		return (
			<div className={cn('ph-no-capture', className)}>
				<span data-markdown-fallback className="whitespace-pre-wrap break-words">
					{text}
				</span>
			</div>
		);
	}

	return (
		<div
			className={cn(
				'prose inherit-color prose-sm dark:prose-invert max-w-none ph-no-capture',
				className,
			)}
		>
			<PlainTextFallback key={children ?? ''} text={children ?? ''}>
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
			</PlainTextFallback>
		</div>
	);
}
