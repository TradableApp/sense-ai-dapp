import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The fee token check decides nothing by itself: it has to be asked at each place that
 * sends a payment. Nothing renders those components in a unit test, so this reads the
 * source and pins each place. Deleting one of them leaves every other test green.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/** The source as the checks below see it. */
const code = (file: string) => read(file);

/** Where `statement` stands as a whole line of code, or -1. */
function statementAt(source: string, statement: string): number {
	return source.indexOf(statement.replace(/;$/, ''));
}

const hasStatement = (source: string, statement: string) => statementAt(source, statement) > -1;

/** Whether `name` is one of the conditions joined by `||` in `expression`. */
function isOperandOf(expression: string, name: string): boolean {
	return expression.includes(name);
}

/** The body of the `useMutation` assigned to `name`, up to the next mutation or the return. */
function mutationBody(source: string, name: string): string {
	const start = source.indexOf(`const ${name} = useMutation(`);
	expect(start, `${name} not found`).toBeGreaterThan(-1);
	const rest = source.slice(start + 1);
	const next = rest.search(/\n\tconst \w+ = useMutation\(|\n\treturn \{/);
	return rest.slice(0, next === -1 ? undefined : next);
}

describe('where the fee token check is asked', () => {
	const mutations = code('src/hooks/useChatMutations.tsx');

	it('the shared refusal throws whenever the check blocks the action', () => {
		const refusal =
			'if (feeTokenCheck.blocks(action)) throw new FeeTokenBlockedError(feeTokenCheck.verdict);';

		expect(hasStatement(mutations, refusal)).toBe(true);
	});

	it.each([
		['initiatePromptMutation', 'prompt'],
		['regenerateMutation', 'prompt'],
		['branchConversationMutation', 'branch'],
		['metadataUpdateMutation', 'metadata'],
	])('%s refuses before anything is sent when %s is switched off', (name, action) => {
		const body = mutationBody(mutations, name);
		const refusal = statementAt(body, `refuseIfSwitchedOff('${action}');`);
		expect(refusal, `${name} does not ask`).toBeGreaterThan(-1);
		// The call is built with prepareContractCall; the refusal has to come before it.
		const built = body.indexOf('prepareContractCall(');
		expect(built, `${name} no longer builds its call with prepareContractCall`).toBeGreaterThan(-1);
		expect(refusal).toBeLessThan(built);
	});

	it.each(['cancelPromptMutation', 'processRefundMutation'])(
		'%s is never refused: getting money back stays possible',
		name => {
			const body = mutationBody(mutations, name);
			expect(body).not.toContain('refuseIfSwitchedOff');
			expect(body).not.toContain('feeTokenCheck');
		},
	);

	it('the composer is disabled while prompts are switched off', () => {
		const chat = code('src/features/chat/Chat.tsx');
		expect(
			hasStatement(chat, "const arePromptsSwitchedOff = feeTokenCheck.blocks('prompt');"),
		).toBe(true);
		['isDisabled', 'isInputDisabled'].forEach(name => {
			const expression = chat.match(new RegExp(`const ${name} =([^;]+);`))?.[1] ?? '';
			expect(isOperandOf(expression, 'arePromptsSwitchedOff'), name).toBe(true);
		});
	});

	it('the plan dialog refuses to submit, says why, and still lets a plan be revoked', () => {
		const dialog = code('src/features/usage/ManagePlanModal.tsx');
		expect(hasStatement(dialog, "const isPlanSwitchedOff = feeTokenCheck.blocks('plan');")).toBe(
			true,
		);
		const submit = dialog.match(/type="submit"\s+disabled=\{([^}]+)\}/)?.[1] ?? '';
		expect(isOperandOf(submit, 'isPlanSwitchedOff')).toBe(true);
		expect(hasStatement(dialog, 'if (isPlanSwitchedOff) return;')).toBe(true);
		// The mutation refuses too, before the approval is built, like the ones in useChatMutations.
		const plan = dialog.slice(dialog.indexOf('const setPlanMutation = useMutation'));
		const refusal = plan.indexOf('if (isPlanSwitchedOff) throw new FeeTokenBlockedError(');
		expect(refusal, 'setPlanMutation does not refuse').toBeGreaterThan(-1);
		expect(refusal).toBeLessThan(plan.indexOf('prepareContractCall('));
		expect(dialog).toContain('<FeeTokenMismatchBanner');
		const revoke = dialog.match(
			/<AlertDialogAction onClick=\{handleRevoke\} disabled=\{([^}]+)\}/,
		)?.[1];
		expect(revoke).toBeDefined();
		expect(revoke).not.toContain('isPlanSwitchedOff');
	});

	it('the banner is mounted once for every page, outside any condition', () => {
		const layout = code('src/layouts/MainLayout.tsx');
		expect(layout).toMatch(/\n\t+<FeeTokenMismatchBanner /);
		expect(layout).not.toMatch(/&&\s*<FeeTokenMismatchBanner/);
	});
});

describe('the gate guard itself', () => {
	const refusal = "refuseIfSwitchedOff('prompt');";
	const flag = "const isPlanSwitchedOff = feeTokenCheck.blocks('plan');";

	it('finds a refusal that stands as its own statement', () => {
		expect(hasStatement(`\t\t\t${refusal}\n\t\t\tconst chain = 1;`, refusal)).toBe(true);
	});

	it.each([
		['a line comment', `\t\t\t// ${refusal}`],
		['a block comment', `\t\t\t/* ${refusal} */`],
		['a comment spanning lines', `\t\t\t/*\n\t\t\t${refusal}\n\t\t\t*/`],
	])('does not count a refusal inside %s', (_, source) => {
		expect(hasStatement(source, refusal)).toBe(false);
	});

	it('does not count a refusal behind a condition', () => {
		expect(hasStatement(`\t\t\tif (false) ${refusal}`, refusal)).toBe(false);
	});

	it.each([
		['a trailing condition', "const isPlanSwitchedOff = feeTokenCheck.blocks('plan') && false;"],
		['a leading condition', "const isPlanSwitchedOff = false && feeTokenCheck.blocks('plan');"],
		['a fallback', "const isPlanSwitchedOff = feeTokenCheck.blocks('plan') || null;"],
	])('refuses a flag with %s', (_, line) => {
		expect(hasStatement(`\t${line}\n`, flag)).toBe(false);
	});

	it('accepts the flag as written', () => {
		expect(hasStatement(`\t${flag}\n`, flag)).toBe(true);
	});

	it('counts a flag only as a condition of its own, not inside another', () => {
		const name = 'arePromptsSwitchedOff';

		expect(isOperandOf(`\n\t\tisProcessing ||\n\t\t${name}`, name)).toBe(true);
		expect(isOperandOf(`\n\t\tisProcessing ||\n\t\t(${name} && false)`, name)).toBe(false);
		expect(isOperandOf(`\n\t\tisProcessing ||\n\t\t!${name}`, name)).toBe(false);
	});
});
