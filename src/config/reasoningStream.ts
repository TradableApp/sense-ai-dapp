import type { StreamEndpoint } from '@/lib/liveReasoning/contract';

import { parseReasoningStreamSetting } from './reasoningStreamConfig';

/**
 * The live reasoning stream this build reads, or null when it is off. The only module that
 * reads `VITE_REASONING_STREAM_URL` (the `live-reasoning-ephemeral` guard). `vite.config.ts`
 * has already refused a malformed value, so a value that still fails here (a unit test's
 * stubbed environment) turns the stream off rather than breaking the chat.
 */
export default function reasoningStreamEndpoint(): StreamEndpoint | null {
	try {
		return parseReasoningStreamSetting(import.meta.env.MODE, {
			VITE_REASONING_STREAM_URL: import.meta.env.VITE_REASONING_STREAM_URL,
			VITE_REASONING_STREAM_MODE: import.meta.env.VITE_REASONING_STREAM_MODE,
		});
	} catch {
		return null;
	}
}
