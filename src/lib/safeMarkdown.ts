import type { Definition, Nodes, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';

import { linkHref } from '@/lib/safeHref';

/**
 * The markdown rule for conversation text, applied to the parsed tree before anything is
 * rendered or copied, so nothing in the text can load a resource or link somewhere unsafe:
 *
 * - an image, inline or by reference, becomes its alt text (inside a link it stays the link's
 *   text), so nothing is fetched by showing it;
 * - raw HTML becomes the text it was written as, never an element;
 * - a link, inline or by reference, keeps its URL only when `linkHref` accepts it (an absolute
 *   http or https URL with no user name or password, in its parsed form); any other link is replaced by its text;
 * - link and image definitions are used to resolve references and are then dropped.
 *
 * The tree is rebuilt, not changed in place.
 */

type SafeUrls = ReadonlyMap<string, string | null>;

const text = (value: string): Text => ({ type: 'text', value });

function definitionsIn(node: Nodes, found: Map<string, string | null>): Map<string, string | null> {
	if (node.type === 'definition') {
		const definition = node as Definition;
		// The first definition of a label wins, as CommonMark resolves it.
		if (!found.has(definition.identifier)) {
			found.set(definition.identifier, linkHref(definition.url));
		}
	}
	if ('children' in node) {
		(node as Parent).children.forEach(child => definitionsIn(child as Nodes, found));
	}
	return found;
}

function sanitizeChildren(children: ReadonlyArray<RootContent>, urls: SafeUrls): RootContent[] {
	return children.flatMap((child): RootContent[] => {
		const node = child as Nodes;
		switch (node.type) {
			case 'image':
			case 'imageReference':
				return node.alt ? [text(node.alt)] : [];
			case 'html':
				return [text(node.value)];
			case 'definition':
				return [];
			case 'link': {
				const inner = sanitizeChildren(node.children, urls) as PhrasingContent[];
				const url = linkHref(node.url);
				return url ? [{ ...node, url, title: null, children: inner }] : inner;
			}
			case 'linkReference': {
				const inner = sanitizeChildren(node.children, urls) as PhrasingContent[];
				const url = urls.get(node.identifier) ?? null;
				if (!url) return inner;
				return [{ type: 'link', url, title: null, children: inner, position: node.position }];
			}
			default:
				return 'children' in node
					? [
							{
								...node,
								children: sanitizeChildren((node as Parent).children, urls),
							} as RootContent,
					  ]
					: [node as RootContent];
		}
	});
}

function sanitizeMarkdownTree(tree: Root): Root {
	const urls = definitionsIn(tree, new Map());
	return { ...tree, children: sanitizeChildren(tree.children, urls) };
}

/** The rule as a remark plugin: `remark().use(remarkSafeContent)` or react-markdown's list. */
export default function remarkSafeContent() {
	return (tree: Root) => sanitizeMarkdownTree(tree);
}
