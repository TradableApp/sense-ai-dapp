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
