import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './source-scan';

/**
 * The fee token check decides nothing by itself: it has to be asked at each place that
 * sends a payment. Nothing renders those components in a unit test, so this reads the
 * source and pins each place. Deleting one of them leaves every other test green.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/** The source as the checks below see it: code only, so a commented-out call does not count. */
const code = (file: string) => stripComments(read(file));

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where `statement` stands as whole lines of code, or -1. Whole lines, so a condition
 * added before or after it (`if (false) …`, `… && false`) is not the statement any more.
 * A space in `statement` matches any run of whitespace, so the formatter may wrap it.
 */
function statementAt(source: string, statement: string): number {
	const words = escape(statement).replace(/ /g, '\\s+');
	const line = new RegExp(`^[ \\t]*${words}[ \\t]*$`, 'm');
	return line.exec(stripComments(source))?.index ?? -1;
}

const hasStatement = (source: string, statement: string) => statementAt(source, statement) > -1;

/** Whether `name` is one of the conditions joined by `||` in `expression`, as it stands. */
function isOperandOf(expression: string, name: string): boolean {
	return stripComments(expression)
		.split('||')
		.some(operand => operand.trim() === name);
}

/** Where the `{…}` opened at `open` closes, counting nested braces; -1 if it never does. */
function closingBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i += 1) {
		if (text[i] === '{') depth += 1;
		if (text[i] === '}') depth -= 1;
		if (depth === 0) return i;
	}
	return -1;
}

/**
 * The opening tag that starts at `start` (`<Tag` … `>`), skipping a `>` inside `{…}` and
 * anything inside a quoted attribute value.
 */
function openingTagAt(text: string, start: number): string {
	let depth = 0;
	for (let i = start; i < text.length; i += 1) {
		const char = text[i];
		if (depth === 0 && (char === '"' || char === "'")) {
			// A quoted attribute value: nothing inside it opens, closes or ends the tag.
			const end = text.indexOf(char, i + 1);
			if (end === -1) break;
			i = end;
		} else if (char === '{') depth += 1;
		else if (char === '}') depth -= 1;
		else if (char === '>' && depth === 0) return text.slice(start, i + 1);
	}
	throw new Error('an opening tag that never closes');
}

/**
 * The `disabled` expression of the `<tag …>` element whose own opening tag holds `marker`
 * (the handler that sends). Only that tag is read, so no other element's attribute can
 * stand in for it. Throws when the element or its `disabled` cannot be found.
 */
function disabledOf(source: string, tag: string, marker: string): string {
	const at = source.indexOf(marker);
	if (at === -1) throw new Error(`${marker} not found`);
	const start = source.lastIndexOf(`<${tag}`, at);
	if (start === -1) throw new Error(`no <${tag}> before ${marker}`);
	const opening = openingTagAt(source, start);
	// The tag's last character is at start + opening.length - 1; a marker after it is outside.
	if (start + opening.length <= at) throw new Error(`${marker} is not inside a <${tag}> tag`);
	const attribute = opening.search(/\sdisabled=\{/);
	if (attribute === -1) throw new Error(`the <${tag}> with ${marker} has no disabled`);
	const open = opening.indexOf('{', attribute);
	const close = closingBrace(opening, open);
	if (close === -1) throw new Error(`the disabled of <${tag}> never closes`);
	return opening.slice(open + 1, close).trim();
}

/** Whether an expression depends on the fee token check. */
const isGatedByCheck = (expression: string) =>
	/SwitchedOff|feeTokenCheck|blocks\(/.test(expression);

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
			'if (feeTokenCheck.blocks(action)) throw new FeeTokenBlockedError(feeTokenCheck.verdict, FEE_TOKEN.symbol);';

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
		// The dialog builds no call of its own: it sends through the plan hook, whose refusal
		// usePlanMutations.test.tsx drives through the real mutation under every verdict. This
		// only pins where that refusal stands, so a reader finds it where the test proves it.
		expect(dialog).toMatch(/\busePlanMutations\(/);
		expect(dialog).not.toContain('prepareContractCall(');
		const plans = code('src/features/usage/usePlanMutations.ts');
		const revokeAt = plans.indexOf('function useRevokePlanMutation(');
		const setPlanAt = plans.indexOf('function useSetPlanMutation(');
		expect(setPlanAt, 'useSetPlanMutation not found').toBeGreaterThan(-1);
		expect(revokeAt, 'useRevokePlanMutation not found').toBeGreaterThan(setPlanAt);
		const setPlan = plans.slice(setPlanAt, revokeAt);
		const refusal = statementAt(
			setPlan,
			"if (feeTokenCheck.blocks('plan')) throw new FeeTokenBlockedError(feeTokenCheck.verdict, FEE_TOKEN.symbol);",
		);
		expect(refusal, 'setting a plan does not refuse').toBeGreaterThan(-1);
		expect(refusal).toBeLessThan(setPlan.indexOf('approveAndSetLimit('));
		expect(plans.slice(revokeAt)).not.toContain('feeTokenCheck');
		expect(dialog).toContain('<FeeTokenMismatchBanner');
		const revoke = dialog.match(
			/<AlertDialogAction onClick=\{handleRevoke\} disabled=\{([^}]+)\}/,
		)?.[1];
		expect(revoke).toBeDefined();
		expect(revoke).not.toContain('isPlanSwitchedOff');
	});

	it.each([
		[
			'src/components/ai/message-actions.tsx',
			"const regenerateSwitchedOff = useSwitchedOffReason('prompt');",
		],
		[
			'src/components/ai/message-actions.tsx',
			"const branchSwitchedOff = useSwitchedOffReason('branch');",
		],
		[
			'src/components/ai/user-message-actions.tsx',
			"const editSwitchedOff = useSwitchedOffReason('prompt');",
		],
		[
			'src/components/ai/edit-prompt-input.tsx',
			"const saveSwitchedOff = useSwitchedOffReason('prompt');",
		],
		[
			'src/features/history/RenameConversationModal.tsx',
			"const renameSwitchedOff = useSwitchedOffReason('metadata', 'dialog');",
		],
		[
			'src/features/history/DeleteConversationDialog.tsx',
			"const deleteSwitchedOff = useSwitchedOffReason('metadata', 'dialog');",
		],
	])('%s asks whether its action is switched off: %s', (file, statement) => {
		expect(hasStatement(code(file), statement)).toBe(true);
	});

	it('the history list disables rename and delete while renames and deletes are switched off', () => {
		const history = code('src/features/history/History.tsx');
		expect(history).toContain('<ConversationActionsMenu');
		// The confirmation is its own dialog, which carries the banner and the switched-off state.
		expect(history).toContain('<DeleteConversationDialog');
		expect(history).not.toContain('<AlertDialogAction');
		expect(history).not.toContain('<DropdownMenuItem');

		const menu = code('src/features/history/ConversationActionsMenu.tsx');
		expect(hasStatement(menu, "const switchedOff = useSwitchedOffReason('metadata');")).toBe(true);
		// The switched-off reason comes first, so nothing else can hide it.
		expect(menu).toMatch(/^\t*const renameReason =\s*switchedOff \?\?/m);
		expect(menu).toMatch(/^\t*const deleteReason =\s*switchedOff \?\?/m);
		// Marked disabled for assistive technology but kept reachable by the arrow keys, so
		// the click handler is what refuses: it must do nothing while there is a reason.
		[
			['renameReason', 'onRename'],
			['deleteReason', 'onDelete'],
		].forEach(([reason, handler]) => {
			expect(hasStatement(menu, `aria-disabled={!!${reason}}`), reason).toBe(true);
			expect(
				hasStatement(menu, `onClick={e => (${reason} ? e.preventDefault() : ${handler}(e))}`),
				handler,
			).toBe(true);
		});
	});

	it('the cancel and refund buttons are never disabled by the check', () => {
		const chat = code('src/features/chat/Chat.tsx');
		const cancel = disabledOf(chat, 'PromptInputCancel', 'onClick={handleCancelPrompt}');
		const refund = disabledOf(chat, 'Button', 'processRefundMutation.mutate(');
		[cancel, refund].forEach(expression => expect(isGatedByCheck(expression)).toBe(false));
	});

	// A modal dialog's backdrop hides the page banner, so each dialog for a paying action
	// mounts its own, outside any condition (the banner renders nothing while all is well).
	it.each([
		'src/features/usage/ManagePlanModal.tsx',
		'src/features/history/RenameConversationModal.tsx',
		'src/features/history/DeleteConversationDialog.tsx',
	])('%s carries the banner itself', file => {
		const dialog = code(file);
		expect(dialog).toMatch(/\n\t+<FeeTokenMismatchBanner /);
		expect(dialog).not.toMatch(/&&\s*<FeeTokenMismatchBanner/);
	});

	it('the banner is mounted once for every page, outside any condition', () => {
		const layout = code('src/layouts/MainLayout.tsx');
		expect(layout).toMatch(/\n\t+<FeeTokenMismatchBanner /);
		expect(layout).not.toMatch(/&&\s*<FeeTokenMismatchBanner/);
	});
});

describe('how the guard reads the button that sends a refund', () => {
	const refundButton = (disabled: string) =>
		`<Button\n\tonClick={() =>\n\t\tlastMessage?.id && processRefundMutation.mutate({ id: 1 })\n\t}\n\t${disabled}\n>\n\tRequest refund\n</Button>`;
	const marker = 'processRefundMutation.mutate(';

	it('reads the disabled of the button that sends, not of an element before it', () => {
		const source = `<Input disabled={isWrong} />\n${refundButton(
			'disabled={processRefundMutation.isPending}',
		)}`;

		expect(disabledOf(source, 'Button', marker)).toBe('processRefundMutation.isPending');
	});

	it('does not read the disabled of an element after the button that sends', () => {
		const source = `${refundButton(
			'variant="outline"',
		)}\n<Button disabled={isRefundSwitchedOff}>Other</Button>`;

		expect(() => disabledOf(source, 'Button', marker)).toThrow();
	});

	it('fails on a switched-off flag in the refund button', () => {
		const source = refundButton(
			'disabled={processRefundMutation.isPending || isRefundSwitchedOff}',
		);

		expect(isGatedByCheck(disabledOf(source, 'Button', marker))).toBe(true);
	});

	it('does not count a marker that starts right after the tag closes as inside it', () => {
		const source = `<Button disabled={isRefundSwitchedOff}>${marker}{ id: 1 })</Button>`;

		expect(() => disabledOf(source, 'Button', marker)).toThrow(/not inside/);
	});

	it.each([
		['a > in a quoted attribute', 'label="a > b"'],
		['a brace in a quoted attribute', "title='{'"],
	])('reads past %s', (_, attribute) => {
		const source = `<Button ${attribute} onClick={() => ${marker}{ id: 1 })} disabled={processRefundMutation.isPending}>`;

		expect(disabledOf(source, 'Button', marker)).toBe('processRefundMutation.isPending');
	});

	it('fails when the button cannot be found', () => {
		expect(() => disabledOf('<Button disabled={x}>Refund</Button>', 'Button', marker)).toThrow();
		expect(() => disabledOf(`<Link onClick={() => ${marker})} />`, 'Button', marker)).toThrow();
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

	it('accepts a statement the formatter wrapped over two lines', () => {
		const thrown = 'if (blocked) throw new FeeTokenBlockedError(verdict, symbol);';

		expect(
			hasStatement(
				'\t\tif (blocked)\n\t\t\tthrow new FeeTokenBlockedError(verdict, symbol);',
				thrown,
			),
		).toBe(true);
		expect(
			hasStatement(
				'\t\tif (blocked)\n\t\t\tthrow new FeeTokenBlockedError(verdict, symbol) && 0;',
				thrown,
			),
		).toBe(false);
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
