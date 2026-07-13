import {
	readBundledAssetBase64,
	TIKZJAX_BUNDLED_ASSET_NAMES,
} from './tikzJaxAssets';

type LuaTikzWindow = Window & {
	__LUATIKZ_TEX_ASSET_BASE64?: Record<string, string>;
};

/**
 * The patched node-tikzjax bootstrap (scripts/tikzjax-bootstrap-patch.cjs)
 * reads its TeX assets from this global instead of the filesystem, so the
 * same code path works on desktop and on mobile (which has no Node runtime).
 */
export function installTikzJaxTexAssets(activeWindow: Window = window): void {
	const target = activeWindow as LuaTikzWindow;
	if (target.__LUATIKZ_TEX_ASSET_BASE64) {
		return;
	}
	const assets: Record<string, string> = {};
	for (const name of TIKZJAX_BUNDLED_ASSET_NAMES) {
		assets[name] = readBundledAssetBase64(name);
	}
	target.__LUATIKZ_TEX_ASSET_BASE64 = assets;
}
