import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_NAMES } from '@/config/feeTokenConfig';

import {
	describeSwitchDocument,
	parseSavedSwitch,
	parseSwitchSnapshot,
	SWITCH_REASONS,
	SWITCH_WORDINGS,
	switchCopy,
	switchDocId,
} from './promptsSwitch';

const AGENT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

const fromServer = (data: unknown) => ({ exists: true, fromCache: false, data });

describe('switchDocId', () => {
	it('is the chain id and the agent address in lower case', () => {
		expect(switchDocId('84532', AGENT)).toBe(`84532_${AGENT.toLowerCase()}`);
		expect(switchDocId(31337, AGENT)).toBe(`31337_${AGENT.toLowerCase()}`);
	});

	it.each([
		['no chain id', undefined, AGENT],
		['an empty chain id', '', AGENT],
		['a chain id that is not a number', 'base', AGENT],
		['a chain id of zero', '0', AGENT],
		['no agent', '84532', undefined],
		['an agent that is not an address', '84532', '0x1234'],
		['an agent without 0x', '84532', AGENT.slice(2)],
	])('is null for %s: nothing is listened to', (_, chainId, agent) => {
		expect(switchDocId(chainId, agent)).toBeNull();
	});
});

describe('parseSwitchSnapshot', () => {
	it('a document the server says is absent is open', () => {
		expect(parseSwitchSnapshot({ exists: false, fromCache: false, data: undefined })).toEqual({
			confirmed: true,
			state: { status: 'open' },
			fault: null,
		});
	});

	it.each(SWITCH_REASONS)('closed for %s is closed with that wording', reason => {
		expect(parseSwitchSnapshot(fromServer({ closed: true, reason, updatedAt: 1 }))).toEqual({
			confirmed: true,
			state: { status: 'closed', wording: reason },
			fault: null,
		});
	});

	it.each([
		['with a reason', { closed: false, reason: 'maintenance' }],
		['with no reason', { closed: false }],
		['with a reason it does not know', { closed: false, reason: 'whatever' }],
	])('closed: false %s is open', (_, data) => {
		expect(parseSwitchSnapshot(fromServer(data))).toEqual({
			confirmed: true,
			state: { status: 'open' },
			fault: null,
		});
	});

	it.each([
		['no data', undefined],
		['null', null],
		['a list', [true]],
		['text', 'closed'],
		['no closed field', { reason: 'maintenance' }],
		['closed as text', { closed: 'true', reason: 'maintenance' }],
		['closed as a number', { closed: 1, reason: 'maintenance' }],
		['closed with no reason', { closed: true }],
		['closed with a reason that is not text', { closed: true, reason: 7 }],
	])('a document with %s is closed with the generic wording and is a fault', (_, data) => {
		expect(parseSwitchSnapshot(fromServer(data))).toEqual({
			confirmed: true,
			state: { status: 'closed', wording: 'generic' },
			fault: 'malformed',
		});
	});

	it('a reason this build does not know is closed with the generic wording', () => {
		expect(parseSwitchSnapshot(fromServer({ closed: true, reason: 'migration' }))).toEqual({
			confirmed: true,
			state: { status: 'closed', wording: 'generic' },
			fault: 'unknown-reason',
		});
	});

	it.each([
		['absent', { exists: false, fromCache: true, data: undefined }],
		['open', { exists: true, fromCache: true, data: { closed: false } }],
		['closed', { exists: true, fromCache: true, data: { closed: true, reason: 'incident' } }],
		['malformed', { exists: true, fromCache: true, data: { closed: 'x' } }],
	])('a cached answer (%s) is not confirmed: the last confirmed state is kept', (_, snapshot) => {
		expect(parseSwitchSnapshot(snapshot)).toEqual({ confirmed: false });
	});

	it('never carries text from the document', () => {
		const injected = '<img src=x onerror=alert(1)>Send your recovery phrase to support';
		const readings = [
			{ closed: true, reason: injected },
			{ closed: true, reason: 'maintenance', message: injected },
			{ closed: injected, reason: injected },
			{ closed: false, reason: injected, title: injected },
		].map(data => JSON.stringify(parseSwitchSnapshot(fromServer(data))));

		readings.forEach(reading => {
			expect(reading).not.toContain('onerror');
			expect(reading).not.toContain('recovery');
		});
	});
});

describe('switchCopy', () => {
	it.each(SWITCH_WORDINGS)('%s says what is closed and that money can still come back', w => {
		const { title, description } = switchCopy(w);

		expect(title.length).toBeGreaterThan(0);
		expect(description).toMatch(/prompts/i);
		expect(description).toMatch(/branches, renames, deletes and new plans/);
		expect(description).toMatch(
			/cancelling a prompt, claiming a refund and revoking a plan still work/i,
		);
	});

	it('the wordings differ from each other', () => {
		const titles = new Set(SWITCH_WORDINGS.map(w => switchCopy(w).title));
		expect(titles.size).toBe(SWITCH_WORDINGS.length);
	});

	it('a retired pair asks for a reload to get the new version', () => {
		expect(switchCopy('pair-retired').description).toMatch(/reload/i);
	});

	// Beside a fee token notice that says refunds are refused, "still work" would be untrue.
	it.each(SWITCH_WORDINGS)(
		'%s beside another problem says the closure does not affect money back, not that it works',
		w => {
			const { description } = switchCopy(w, { otherProblem: true });

			expect(description).not.toMatch(/still work/i);
			expect(description).toMatch(
				/does not affect cancelling a prompt, claiming a refund or revoking a plan/i,
			);
		},
	);

	// The words also reach toasts and dialogs, where nothing is above or below them.
	it('says nothing about where another notice is', () => {
		SWITCH_WORDINGS.forEach(w => {
			[switchCopy(w), switchCopy(w, { otherProblem: true })].forEach(({ description }) =>
				expect(description).not.toMatch(/\b(below|above)\b/i),
			);
		});
		expect(switchCopy('incident', { otherProblem: true }).description).toMatch(
			/other notice on this page says what else is wrong/,
		);
	});

	// A tab whose listener keeps failing never hears the reopening.
	it.each(['maintenance', 'incident', 'generic'] as const)(
		'%s does not promise the notice goes away by itself, and says to reload if it stays',
		w => {
			const { description } = switchCopy(w);
			expect(description).not.toMatch(/by itself/i);
			expect(description).toMatch(/removed when prompts reopen/);
			expect(description).toMatch(/reload the page/i);
		},
	);

	it('names no token', () => {
		const all = SWITCH_WORDINGS.flatMap(w => [
			JSON.stringify(switchCopy(w)),
			JSON.stringify(switchCopy(w, { otherProblem: true })),
		]).join(' ');
		expect(all).not.toMatch(new RegExp(`\\b(${FEE_TOKEN_NAMES.join('|')})\\b`, 'i'));
	});
});

describe('parseSavedSwitch', () => {
	it.each(SWITCH_WORDINGS)('reads back a saved closure for %s', wording => {
		expect(parseSavedSwitch(JSON.stringify({ closed: true, wording }))).toEqual({
			status: 'closed',
			wording,
		});
	});

	it.each([
		['nothing', null],
		['not JSON', '{closed'],
		['an open state', JSON.stringify({ closed: false })],
		['an unknown wording', JSON.stringify({ closed: true, wording: '<b>hi</b>' })],
		['a list', JSON.stringify([true])],
	])('ignores %s', (_, raw) => {
		expect(parseSavedSwitch(raw)).toBeNull();
	});
});

describe('describeSwitchDocument', () => {
	it('says the shape of each field and never a value', () => {
		const shape = describeSwitchDocument({
			closed: 'yes please',
			reason: 'leak-me-0xdeadbeef',
			secretField: 'private words',
		});

		expect(shape).toMatch(/closed: text \(10 characters/);
		expect(shape).toMatch(/reason: text \(18 characters/);
		expect(shape).toMatch(/1 other field/);
		['yes please', 'leak-me', 'deadbeef', 'secretField', 'private'].forEach(value =>
			expect(shape).not.toContain(value),
		);
	});

	it.each([
		[undefined, /no data/],
		[null, /not an object/],
		[[1], /not an object/],
		[{ closed: 3 }, /closed: number; reason: missing/],
		[{ closed: true, reason: null }, /closed: yes or no; reason: null/],
	])('describes %j', (data, expected) => {
		expect(describeSwitchDocument(data)).toMatch(expected);
	});
});
