declare module 'stopword' {
	export function removeStopwords(_words: string[], _stopwords?: string[]): string[];
	export const eng: string[];
}
