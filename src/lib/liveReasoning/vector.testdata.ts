/**
 * The shared test vector of the live reasoning contract, version 1. The oracle holds the same
 * values in `oracle/test/streamContract.test.js`; the two copies keep both sides byte-for-byte
 * equal, so a change here is a change there too.
 */
export const VECTOR = {
	keyHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
	ivHex: 'a0a1a2a3a4a5a6a7a8a9aaab',
	plaintext:
		'{"v":1,"answerMessageId":"42","run":"0123456789abcdef","seq":1,"replica":"deadbeef","type":"step","data":{"attempt":1,"title":"Reading market context","description":"Checked recent sentiment for BTC."}}',
	frame:
		'oKGio6Slpqeoqaqr.nToKD3/6Lp0DC/SkYgiNuwPfOHf3/iZOpiwStF2HV3OnGGXFjRJiD2yoMf4+QrqYJXgiLQTyNlwyO3p8nkGpksbZ9QNZxoXCzsCbfe6qrt+obYmI57XgCotXBLjC7ijkragJz2La7rmkoCQx8fyIRVQkQ5TvGblIRruywZZv0B+gcNQWvSWgelYrle5mavK55q3IE8ry1q6ZqM6W3a5EX693cZOMSAN+52lARwvyxIQUQ5PsIhXLUPbrG1wy9j8xW0RsizSSlc+OIA1DLZj99YCZs7Q2y6k2OjY=',
	proof: 'zmsj4OksK8D2N9JMs__j2qRCsgSGomdTiRR9Dl6UUb4',
	proofHex: 'ce6b23e0e92c2bc0f637d24cb3ffe3daa442b20486a2675389147d0e5e9451be',
} as const;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

/** The vector's key as the session key is held in the dApp: AES-GCM, extractable. */
export const importVectorKey = (): Promise<CryptoKey> =>
	window.crypto.subtle.importKey('raw', hexBytes(VECTOR.keyHex), { name: 'AES-GCM' }, true, [
		'encrypt',
		'decrypt',
	]);

export const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
