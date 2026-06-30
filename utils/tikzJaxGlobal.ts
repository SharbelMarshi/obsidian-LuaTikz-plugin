type LuaTikzWindow = Window & {
	__LUATIKZ_TEX_DIR?: string;
};

/**
 * node-tikzjax reads its TeX directory from the global object during WASM bootstrap.
 */
export function setTikzJaxTexDir(texDir: string, activeWindow: Window = window): void {
	const targetWindow = activeWindow as LuaTikzWindow;
	targetWindow.__LUATIKZ_TEX_DIR = texDir;
}
