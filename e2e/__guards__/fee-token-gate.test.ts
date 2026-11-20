import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The fee token check decides nothing by itself: it has to be asked at each place that
 * sends a payment. Nothing renders those components in a unit test, so this reads the
 * source and pins each place. Deleting one of them leaves every other test green.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/** The body of the `useMutation` assigned to `name`, up to the next mutation or the return. */
function mutationBody(source: string, name: string): string {
	const start = source.indexOf(`const ${name} = useMutation(`);
	expect(start, `${name} not found`).toBeGreaterThan(-1);
	const rest = source.slice(start + 1);
	const next = rest.search(/\n\tconst \w+ = useMutation\(|\n\treturn \{/);
	return rest.slice(0, next === -1 ? undefined : next);
}

describe('where the fee token check is asked', () => {
	const mutations = read('src/hooks/useChatMutations.tsx');

	it.each([
		['initiatePromptMutation', 'prompt'],
		['regenerateMutation', 'prompt'],
		['branchConversationMutation', 'branch'],
		['metadataUpdateMutation', 'metadata'],
	])('%s refuses before anything is sent when %s is switched off', (name, action) => {
		const body = mutationBody(mutations, name);
		const refusal = body.indexOf(`refuseIfSwitchedOff('${action}')`);
		expect(refusal, `${name} does not ask`).toBeGreaterThan(-1);
		// The call is built with prepareContractCall; the refusal has to come before it.
		const built = body.indexOf('prepareContractCall(');
		expect(built, `${name} no longer builds its call with prepareContractCall`).toBeGreaterThan(-1);
		expect(refusal).toBeLessThan(built);
	});

	it.each(['cancelPromptMutation', 'processRefundMutation'])(
		'%s is never refused: getting money back stays possible',
		name => {
			expect(mutationBody(mutations, name)).not.toContain('refuseIfSwitchedOff');
		},
	);

	it('the composer is disabled while prompts are switched off', () => {
		const chat = read('src/features/chat/Chat.tsx');
		expect(chat).toMatch(/const arePromptsSwitchedOff = feeTokenCheck\.blocks\('prompt'\)/);
		['isDisabled', 'isInputDisabled'].forEach(name => {
			const expression = chat.match(new RegExp(`const ${name} =([^;]+);`))?.[1] ?? '';
			expect(expression, name).toContain('arePromptsSwitchedOff');
		});
	});

	it('the plan dialog refuses to submit, says why, and still lets a plan be revoked', () => {
		const dialog = read('src/features/usage/ManagePlanModal.tsx');
		expect(dialog).toMatch(/const isPlanSwitchedOff = feeTokenCheck\.blocks\('plan'\)/);
		const submit = dialog.match(/type="submit"\s+disabled=\{([^}]+)\}/)?.[1] ?? '';
		expect(submit).toContain('isPlanSwitchedOff');
		expect(dialog).toMatch(/if \(isPlanSwitchedOff\) return;/);
		expect(dialog).toContain('<FeeTokenMismatchBanner');
		const revoke = dialog.match(
			/<AlertDialogAction onClick=\{handleRevoke\} disabled=\{([^}]+)\}/,
		)?.[1];
		expect(revoke).toBeDefined();
		expect(revoke).not.toContain('isPlanSwitchedOff');
	});

	it('the banner is mounted once for every page, outside any condition', () => {
		const layout = read('src/layouts/MainLayout.tsx');
		expect(layout).toMatch(/\n\t+<FeeTokenMismatchBanner /);
		expect(layout).not.toMatch(/&&\s*<FeeTokenMismatchBanner/);
	});
});
