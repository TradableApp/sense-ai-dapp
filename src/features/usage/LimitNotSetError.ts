/**
 * The approval was confirmed and setting the limit then failed. The approval stays on the
 * token: the user is told so, and the plan and balance are read again. It cannot be spent
 * outside a limit set on the escrow, and while a plan is active Revoke stops all spending.
 */
export default class LimitNotSetError extends Error {
	constructor(cause: unknown) {
		const reason = cause instanceof Error && cause.message ? cause.message : 'an unexpected error';
		super(
			`The approval went through, but setting the limit failed: ${reason}. The approval stands, but the agent can spend only within a limit you have set. Set the plan again to finish it; while a plan is active, Revoke stops all spending.`,
		);
		this.name = 'LimitNotSetError';
		this.cause = cause;
	}
}
