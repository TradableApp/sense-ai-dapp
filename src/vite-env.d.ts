/// <reference types="vite/client" />

import type { FunctionComponent, SVGProps } from 'react';

declare module '*.css' {
	const content: Record<string, string>;
	export default content;
}

declare module '*.svg?react' {
	const content: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>;
	export default content;
}

declare module '@/assets/tradable-logo-mono.svg?react' {
	const content: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>;
	export default content;
}

declare module '@/assets/tradable-logo.svg?react' {
	const content: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>;
	export default content;
}

declare module '@/assets/able-token-logo.svg?react' {
	const content: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>;
	export default content;
}
