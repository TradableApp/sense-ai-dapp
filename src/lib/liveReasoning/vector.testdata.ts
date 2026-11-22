/**
 * The shared test vectors of the live reasoning contract, version 1: one per frame type, each
 * with the fixed key, its own fixed IV and a fixed plaintext. The oracle holds the same data in
 * `oracle/test/streamContract.test.js`, and both repos pin the same SHA-256 of it
 * (`STREAM_VECTORS_SHA256`), since no CI job checks one repo against the other.
 *
 * The hash is of the canonical form: JSON with the keys of every object sorted (JavaScript's
 * default sort, by UTF-16 code unit), arrays kept in order, no whitespace, strings and numbers as
 * JSON.stringify writes them; SHA-256 of its UTF-8, in lower-case hex (`canonicalJson` below; the
 * oracle's is the same function). If a vector changes here, update the hash here, then copy the
 * vectors and the same hash into the oracle's test: a change on one side only fails that side's
 * pin, or leaves the two hashes different.
 */
export interface FrameVector {
	type: string;
	ivHex: string;
	plaintext: string;
	frame: string;
}

export const STREAM_VECTORS = {
	keyHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
	proof: {
		answerMessageId: '42',
		proof: 'zmsj4OksK8D2N9JMs__j2qRCsgSGomdTiRR9Dl6UUb4',
		proofHex: 'ce6b23e0e92c2bc0f637d24cb3ffe3daa442b20486a2675389147d0e5e9451be',
	},
	frames: [
		{
			type: 'step',
			ivHex: 'a0a1a2a3a4a5a6a7a8a9aaab',
			plaintext:
				'{"v":1,"answerMessageId":"42","run":"0123456789abcdef","seq":1,"replica":"deadbeef","type":"step","data":{"attempt":1,"title":"Reading market context","description":"Checked recent sentiment for BTC."}}',
			frame:
				'oKGio6Slpqeoqaqr.nToKD3/6Lp0DC/SkYgiNuwPfOHf3/iZOpiwStF2HV3OnGGXFjRJiD2yoMf4+QrqYJXgiLQTyNlwyO3p8nkGpksbZ9QNZxoXCzsCbfe6qrt+obYmI57XgCotXBLjC7ijkragJz2La7rmkoCQx8fyIRVQkQ5TvGblIRruywZZv0B+gcNQWvSWgelYrle5mavK55q3IE8ry1q6ZqM6W3a5EX693cZOMSAN+52lARwvyxIQUQ5PsIhXLUPbrG1wy9j8xW0RsizSSlc+OIA1DLZj99YCZs7Q2y6k2OjY=',
		},
	] as FrameVector[],
} as const;

export const STREAM_VECTORS_SHA256 =
	'e09ee75f9b768d739b145956a61e8702919f33040d70ff50a9ce9195dca3deba';

/** The canonical form the pinned hash is taken of (defined identically in the oracle). */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export const hexBytes = (hex: string) =>
	Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

/** The vectors' key as the session key is held in the dApp: AES-GCM, extractable. */
export const importVectorKey = (): Promise<CryptoKey> =>
	window.crypto.subtle.importKey(
		'raw',
		hexBytes(STREAM_VECTORS.keyHex),
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt'],
	);

export const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
