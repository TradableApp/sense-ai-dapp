import { zodResolver } from '@hookform/resolvers/zod';

interface Issue {
	path: readonly PropertyKey[];
	message: string;
}

interface ParsesForm {
	safeParse(_input: unknown): { success: boolean; error?: { issues: readonly Issue[] } };
}

/**
 * Every message a form schema gives for `input`, keyed by field. The words are what the form
 * shows under each field, so a test pins them exactly.
 */
export function messagesFor(schema: ParsesForm, input: unknown): Record<string, string[]> {
	const result = schema.safeParse(input);
	if (result.success) return {};
	return (result.error?.issues ?? []).reduce<Record<string, string[]>>((acc, issue) => {
		const field = issue.path.map(String).join('.');
		return { ...acc, [field]: [...(acc[field] ?? []), issue.message] };
	}, {});
}

/** The message react-hook-form shows for each field after the resolver validates `values`. */
export async function resolverMessages(
	schema: ParsesForm,
	values: Record<string, unknown>,
): Promise<Record<string, string | undefined>> {
	// The resolver is overloaded per zod major; the schemas under test are zod objects, the
	// structural type above only keeps this helper free of the major's own types.
	const resolve = zodResolver(schema as unknown as Parameters<typeof zodResolver>[0]);
	const { errors } = await resolve(values, undefined, {
		fields: {},
		shouldUseNativeValidation: false,
	});
	return Object.fromEntries(
		Object.entries(errors).map(([field, error]) => [field, error?.message as string | undefined]),
	);
}
