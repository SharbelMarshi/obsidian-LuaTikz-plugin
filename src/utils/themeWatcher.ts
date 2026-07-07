/** Observe Obsidian's body.theme-dark class and fire when light/dark mode changes. */
export function watchObsidianDarkMode(onChange: (isDark: boolean) => void): () => void {
	let isDark = activeDocument.body.classList.contains('theme-dark');

	const observer = new MutationObserver(() => {
		const next = activeDocument.body.classList.contains('theme-dark');
		if (next === isDark) {
			return;
		}
		isDark = next;
		onChange(isDark);
	});

	observer.observe(activeDocument.body, {
		attributes: true,
		attributeFilter: ['class'],
	});

	return () => observer.disconnect();
}

export function isObsidianDarkMode(): boolean {
	return activeDocument.body.classList.contains('theme-dark');
}
