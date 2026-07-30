import { containsRtlText } from './guards';

/**
 * Set text direction from the text that will actually be *displayed in this
 * element*.
 *
 * Never pass a TikZ source here to style plugin chrome: the rendered diagram is
 * an image whose text direction LaTeX has already resolved, while the toolbar,
 * error titles and buttons around it are English. Keying their direction off
 * whether the diagram happens to contain Hebrew or Arabic flipped the whole
 * card — the Export split button, the error buttons and all.
 */
export function applyRtlToContainer(containerEl: HTMLElement, displayedText: string): void {
	const isRtl = containsRtlText(displayedText);
	containerEl.toggleClass('luatikz-rtl', isRtl);
	containerEl.toggleClass('luatikz-ltr', !isRtl);
	containerEl.setAttr('dir', isRtl ? 'rtl' : 'ltr');
}
