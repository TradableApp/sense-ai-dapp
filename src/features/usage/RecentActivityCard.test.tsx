import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN } from '@/config/feeToken';
import RecentActivityCard from '@/features/usage/RecentActivityCard';

const { graphRequestMock } = vi.hoisted(() => ({ graphRequestMock: vi.fn() }));

vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = graphRequestMock;
	},
	gql: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
		strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
}));

vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ ownerAddress: '0x00000000000000000000000000000000000000aa' }),
}));

const PROMPT_TX = '0x2222222222222222222222222222222222222222222222222222222222222222';
const CANCEL_TX = '0x3333333333333333333333333333333333333333333333333333333333333333';

// What the subgraph returns for a cancelled prompt, newest first: the cancel's fee and the amount
// it hands back share one transaction (and one timestamp), and the prompt's payment came before.
const CANCELLED_PROMPT = [
	{
		id: `${CANCEL_TX}-4`,
		type: 'CANCEL',
		amount: '-100000000000000000',
		timestamp: '1700000100',
		transactionHash: CANCEL_TX,
	},
	{
		id: `${CANCEL_TX}-4-return`,
		type: 'CANCEL_RETURN',
		amount: '1000000000000000000',
		timestamp: '1700000100',
		transactionHash: CANCEL_TX,
	},
	{
		id: `${PROMPT_TX}-2`,
		type: 'CONVERSATION',
		amount: '-1000000000000000000',
		timestamp: '1700000000',
		transactionHash: PROMPT_TX,
	},
];

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<RecentActivityCard />
		</QueryClientProvider>,
	);
}

function rowOf(label: string) {
	const labelEl = screen.getByText(label);
	const row = labelEl.closest('div.flex.items-center');
	if (!row) throw new Error(`no row around "${label}"`);
	return row as HTMLElement;
}

describe('RecentActivityCard', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it('shows a cancelled prompt as the amount paid, the fee and the amount returned', async () => {
		graphRequestMock.mockResolvedValue({ activities: CANCELLED_PROMPT });
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		renderCard();

		await screen.findByText('Prompt Amount Returned');
		const paid = rowOf('AI Conversation');
		const fee = rowOf('Prompt Cancelled');
		const returned = rowOf('Prompt Amount Returned');

		expect(within(paid).getByText(`-1.0 ${FEE_TOKEN.symbol}`)).toBeTruthy();
		expect(within(fee).getByText(`-0.1 ${FEE_TOKEN.symbol}`)).toBeTruthy();
		const returnedAmount = within(returned).getByText(`1.0 ${FEE_TOKEN.symbol}`);
		// Money coming back is coloured; money going out is not.
		expect(returnedAmount.className).toContain('text-green-500');
		expect(within(fee).getByText(`-0.1 ${FEE_TOKEN.symbol}`).className).not.toContain(
			'text-green-500',
		);

		// The order the subgraph gave is kept, and two rows from one transaction are not merged.
		const labels = screen
			.getAllByText(/^(AI Conversation|Prompt Cancelled|Prompt Amount Returned)$/)
			.map(el => el.textContent);
		expect(labels).toEqual(['Prompt Cancelled', 'Prompt Amount Returned', 'AI Conversation']);
		expect(screen.queryByText('Unknown Action')).toBeNull();

		// Two rows sharing a transaction hash still have keys of their own.
		const duplicateKey = consoleError.mock.calls.some(args => String(args[0]).includes('same key'));
		expect(duplicateKey).toBe(false);
	});

	it('shows each amount exactly as the chain moved it, never rounded', async () => {
		graphRequestMock.mockResolvedValue({
			activities: [
				{
					id: `${CANCEL_TX}-7`,
					type: 'CANCEL',
					amount: '-250000000000000000',
					timestamp: '1700000300',
					transactionHash: CANCEL_TX,
				},
				{
					id: `${PROMPT_TX}-8`,
					type: 'BRANCH',
					amount: '-40000000000000000',
					timestamp: '1700000200',
					transactionHash: PROMPT_TX,
				},
			],
		});

		renderCard();

		await screen.findByText('Conversation Branched');
		// 0.25 is not rounded up to 0.3, and 0.04 is not shown as 0.0.
		expect(within(rowOf('Prompt Cancelled')).getByText(`-0.25 ${FEE_TOKEN.symbol}`)).toBeTruthy();
		expect(
			within(rowOf('Conversation Branched')).getByText(`-0.04 ${FEE_TOKEN.symbol}`),
		).toBeTruthy();
	});

	it('shows no amount for an action that moved nothing', async () => {
		graphRequestMock.mockResolvedValue({
			activities: [
				{
					id: `${CANCEL_TX}-9`,
					type: 'RENAME',
					amount: '0',
					timestamp: '1700000400',
					transactionHash: CANCEL_TX,
				},
			],
		});

		renderCard();

		await screen.findByText('Conversation Renamed');
		expect(
			within(rowOf('Conversation Renamed')).queryByText(FEE_TOKEN.symbol, { exact: false }),
		).toBeNull();
	});
});
