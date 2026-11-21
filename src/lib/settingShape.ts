// Kept free of imports: `vite.config.ts` loads this file, through the store and fee token
// checks, before the `@/` alias or any asset loader exists.

const HEX = /^[0-9a-fA-F]+$/;

/**
 * What a refused build setting looks like, without the value: a private key pasted into the
 * wrong setting is 64 hex digits, and the message it goes into is printed to a terminal or
 * a CI log.
 */
export default function describeShape(value: string): string {
	if (value === '') return 'nothing';
	const prefixed = value.startsWith('0x');
	const digits = prefixed ? value.slice(2) : value;
	return [
		`${value.length} characters`,
		prefixed ? 'starts with 0x' : 'does not start with 0x',
		HEX.test(digits) ? 'all hex' : 'not all hex',
	].join(', ');
}
