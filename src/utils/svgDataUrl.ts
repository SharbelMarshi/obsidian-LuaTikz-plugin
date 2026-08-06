import { encodeUtf8Base64 } from './base64Utils';

/**
 * The one place an SVG string becomes an <img src>. Kept single so a result
 * whose svgText is rewritten (dark-mode inversion) can never ship a dataUrl
 * encoding the old text — regenerate both through here.
 */
export function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${encodeUtf8Base64(svgText)}`;
}
