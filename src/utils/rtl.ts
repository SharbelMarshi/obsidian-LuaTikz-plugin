import { containsRtlText } from './guards';

export function applyRtlToContainer(containerEl: HTMLElement, source: string): void {
	const isRtl = containsRtlText(source);
	containerEl.toggleClass('luatikz-rtl', isRtl);
	containerEl.toggleClass('luatikz-ltr', !isRtl);
	containerEl.setAttr('dir', isRtl ? 'rtl' : 'ltr');
}
