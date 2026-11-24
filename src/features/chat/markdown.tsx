import type { FC, ReactNode } from 'react';

import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

function MarkdownParagraph({ children }: { children: ReactNode }) {
	return <p className="inline">{children}</p>;
}

/** How an answer's markdown is rendered, stored or provisional alike. */
export const markdownComponents: Record<string, FC<any>> = { p: MarkdownParagraph };
export const remarkPlugins = [remarkGfm, remarkBreaks];
