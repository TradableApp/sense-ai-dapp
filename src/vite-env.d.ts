/// <reference types="vite/client" />

import type { FunctionComponent, SVGProps } from 'react';

interface ImportMetaEnv {
	readonly VITE_AGENT_CONTRACT_ADDRESS: string;
	readonly VITE_API_KEY: string;
	readonly VITE_APP_CHECK_DEBUG_TOKEN: string;
	readonly VITE_APP_DEBUG: string;
	readonly VITE_APP_ID: string;
	readonly VITE_APP_VERSION: string;
	readonly VITE_AUTH_DOMAIN: string;
	readonly VITE_AUTONOMYS_NETWORK: string;
	readonly VITE_BLOCK_EXPLORER_API_URL: string;
	readonly VITE_BLOCK_EXPLORER_NAME: string;
	readonly VITE_BLOCK_EXPLORER_URL: string;
	readonly VITE_CHAIN_ID: string;
	readonly VITE_CHAIN_NAME: string;
	readonly VITE_CHAIN_NATIVE_CURRENCY_DECIMALS: string;
	readonly VITE_CHAIN_NATIVE_CURRENCY_NAME: string;
	readonly VITE_CHAIN_NATIVE_CURRENCY_SYMBOL: string;
	readonly VITE_CHAIN_RPC_URL: string;
	readonly VITE_CHAIN_SLUG: string;
	readonly VITE_DATABASE_URL: string;
	readonly VITE_ESCROW_CONTRACT_ADDRESS: string;
	readonly VITE_MEASUREMENT_ID: string;
	readonly VITE_MESSAGING_SENDER_ID: string;
	readonly VITE_ORACLE_PUBLIC_KEY: string;
	readonly VITE_ORACLE_WEBSOCKET_URL: string;
	readonly VITE_POSTHOG_DEBUG_SECRET: string;
	readonly VITE_PROJECT_ID: string;
	readonly VITE_PUBLIC_POSTHOG_HOST: string;
	readonly VITE_PUBLIC_POSTHOG_KEY: string;
	readonly VITE_RECAPTCHA_SITE_KEY: string;
	readonly VITE_SENTRY_DSN: string | undefined;
	readonly VITE_SENTRY_ENVIRONMENT: string | undefined;
	readonly VITE_STORAGE_BUCKET: string;
	readonly VITE_THE_GRAPH_API_URL: string;
	readonly VITE_THIRDWEB_CLIENT_ID: string;
	readonly VITE_TOKEN_CONTRACT_ADDRESS: string;
}

// eslint-disable-next-line no-unused-vars
interface ImportMeta {
	readonly env: ImportMetaEnv;
}

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

declare module 'react-syntax-highlighter' {
	const c: any;
	export default c;
	export const Prism: any;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
	const oneDark: any;
	const oneLight: any;
	export { oneDark, oneLight };
}

declare module 'stopword' {
	export function removeStopwords(_words: string[], _stopwords?: string[]): string[];
	export const eng: string[];
}
