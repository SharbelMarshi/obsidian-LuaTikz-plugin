import {
	TIKZJAX_TEX_ASSETS_BASE64,
} from '../../generated/tikzjaxTexAssets';

export type TikzJaxBundledAssetName = 'core.dump.gz' | 'tex.wasm.gz' | 'tex_files.tar.gz';

const ASSET_NAMES: readonly TikzJaxBundledAssetName[] = [
	'core.dump.gz',
	'tex.wasm.gz',
	'tex_files.tar.gz',
];

function isBundledAssetName(name: string): name is TikzJaxBundledAssetName {
	return (ASSET_NAMES as readonly string[]).includes(name);
}

export function readBundledAssetBase64(fileName: TikzJaxBundledAssetName): string {
	const assets = TIKZJAX_TEX_ASSETS_BASE64 as Record<TikzJaxBundledAssetName, string>;
	const encoded = assets[fileName];
	if (typeof encoded !== 'string' || encoded.length === 0) {
		throw new Error(`Missing bundled TikZJax asset: ${fileName}`);
	}
	return encoded;
}

export function assertBundledAssetName(fileName: string): TikzJaxBundledAssetName {
	if (!isBundledAssetName(fileName)) {
		throw new Error(`Unknown bundled TikZJax asset: ${fileName}`);
	}
	return fileName;
}

export const TIKZJAX_BUNDLED_ASSET_NAMES = ASSET_NAMES;
