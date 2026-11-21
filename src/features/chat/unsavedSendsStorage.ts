import type { UnsavedSend } from './unsavedSends';

export function savedSendsKey(_owner: string): string | null {
	return null;
}

export function parseSavedSends(
	_raw: string | null,
	_owner: string,
	_now: number,
): readonly UnsavedSend[] {
	return [];
}
