/* eslint-disable no-promise-executor-return */
import { mockAiResponseTemplates, mockReasoningPool, mockSourcesPool } from './mockData';

const MOCK_REASONING_STEP_DELAY = 900;
const MOCK_FAILURE_RATE = 0.1; // 10% chance of a simulated AI error

/**
 * Simulates the TEE/Oracle AI process, including potential failures.
 * @param {string} userQuery - The content of the user's message.
 * @param {string} aiCorrelationId - The unique ID for this specific AI response.
 * @param {function} onReasoningStep - Callback to stream a reasoning step.
 * @param {function} onFinalAnswer - Callback to deliver the final answer object.
 * @param {string} [regenerationMode] - Optional mode to alter the response (e.g., 'concise').
 */
const simulateOracleProcess = async (
	userQuery,
	aiCorrelationId,
	onReasoningStep,
	onFinalAnswer,
	regenerationMode,
) => {
	console.log(
		`%c[mockApi] Starting AI simulation for query: "${userQuery}" (aiCorrelationId: ${aiCorrelationId}, mode: ${regenerationMode})`,
		'color: purple',
	);
	const thinkingStartTime = Date.now();
	const reasoningSteps = mockReasoningPool[Math.floor(Math.random() * mockReasoningPool.length)];

	for (const step of reasoningSteps) {
		await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
		onReasoningStep(aiCorrelationId, step);

		if (Math.random() < MOCK_FAILURE_RATE) {
			console.error(`%c[mockApi] Simulated AI failure for ${aiCorrelationId}.`, 'color: red');
			const finalDuration = Math.round((Date.now() - thinkingStartTime) / 1000);
			onFinalAnswer(aiCorrelationId, {
				content:
					'**Error:** The AI model encountered an unexpected issue. Please try regenerating the response.',
				sources: [],
				reasoningDuration: finalDuration,
			});
			return;
		}
	}

	await new Promise(resolve => setTimeout(resolve, MOCK_REASONING_STEP_DELAY));
	const template =
		mockAiResponseTemplates[Math.floor(Math.random() * mockAiResponseTemplates.length)];
	const baseContent = template.replace('{query}', userQuery.substring(0, 20));
	const finalContent = regenerationMode
		? `**${regenerationMode.charAt(0).toUpperCase() + regenerationMode.slice(1)}:** ${baseContent}`
		: baseContent;

	const finalSources = mockSourcesPool[Math.floor(Math.random() * mockSourcesPool.length)];
	const finalDuration = Math.round((Date.now() - thinkingStartTime) / 1000);

	const finalAnswer = {
		content: finalContent,
		sources: finalSources,
		reasoningDuration: finalDuration,
	};
	console.log('%c[mockApi] Streaming final answer.', 'color: purple', finalAnswer);
	onFinalAnswer(aiCorrelationId, finalAnswer);
};

export default simulateOracleProcess;
