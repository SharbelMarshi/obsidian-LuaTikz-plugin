declare global {
	interface Window {
		__LUATIKZ_TEX_DIR?: string;
	}
}

/**
 * node-tikzjax reads its TeX directory from the global object during WASM bootstrap.
 * Obsidian runs in Electron where `window` is available; the globalThis assignment is
 * kept as a fallback for the bundled bootstrap patch.
 */
export function setTikzJaxTexDir(texDir: string): void {
	if (typeof window !== 'undefined') {
		window.__LUATIKZ_TEX_DIR = texDir;
	}

	// eslint-disable-next-line no-restricted-globals -- isolated: required by bundled node-tikzjax bootstrap
	(globalThis as { __LUATIKZ_TEX_DIR?: string }).__LUATIKZ_TEX_DIR = texDir;
}
