/** Lazy Node builtins for desktop paths — avoids static imports flagged on mobile review. */

export function nodeFs(): typeof import('fs') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require('fs') as typeof import('fs');
}

export function nodePath(): typeof import('path') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require('path') as typeof import('path');
}

export function nodeCrypto(): typeof import('crypto') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require('crypto') as typeof import('crypto');
}

export function nodeChildProcess(): typeof import('child_process') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require('child_process') as typeof import('child_process');
}

export function decodeBase64(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function encodeUtf8Base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

export function encodeBytesBase64(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
