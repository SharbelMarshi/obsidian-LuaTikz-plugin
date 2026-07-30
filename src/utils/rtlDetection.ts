const HEBREW_RE = /[\u0590-\u05FF]/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function containsHebrew(text: string): boolean {
	return HEBREW_RE.test(text);
}

export function containsArabic(text: string): boolean {
	return ARABIC_RE.test(text);
}

export function containsRtl(text: string): boolean {
	return containsHebrew(text) || containsArabic(text);
}

export function containsArabicMacro(text: string): boolean {
	return /\\ar\{/.test(text) || /\\textarabic\{/.test(text);
}

export function containsHebrewMacro(text: string): boolean {
	return /\\he\{/.test(text) || /\\texthebrew\{/.test(text);
}

/** Arabic Unicode or \\ar{...} / \\textarabic{...} in source. */
export function containsArabicContent(text: string): boolean {
	return containsArabic(text) || containsArabicMacro(text);
}

/** Hebrew Unicode or \\he{...} / \\texthebrew{...} in source. */
export function containsHebrewContent(text: string): boolean {
	return containsHebrew(text) || containsHebrewMacro(text);
}

/** Any RTL macro, regardless of whether its content is RTL Unicode. */
export function containsRtlMacro(text: string): boolean {
	return containsHebrewMacro(text) || containsArabicMacro(text);
}
