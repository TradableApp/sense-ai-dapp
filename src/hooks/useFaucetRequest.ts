export function forgetFaucetReports(): void {}

export default function useFaucetRequest(): { requestTokens: () => Promise<void> } {
	return { requestTokens: async () => undefined };
}
