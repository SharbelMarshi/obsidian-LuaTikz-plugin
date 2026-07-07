const GRID_LINE_RE = /^\s*(?:%\s*)?grid\s*[=:]\s*(\d+(?:\.\d+)?)\s*$/i;

export function parseGridStep(source: string): number | null {
	for (const line of source.split('\n')) {
		const match = line.match(GRID_LINE_RE);
		if (match) {
			const step = Number.parseFloat(match[1]);
			if (Number.isFinite(step) && step > 0) {
				return step;
			}
		}
	}
	return null;
}

export function isObsidianGridDirectiveLine(line: string): boolean {
	return GRID_LINE_RE.test(line.trim());
}

export function injectGridIntoSource(source: string, step: number): string {
	if (source.includes('\\Grid(') || source.includes('\\draw[step=')) {
		return source;
	}
	const gridLine = `\\draw[step=${step},gray!20,very thin] (0,0) grid (10,10);`;
	if (source.includes('\\begin{tikzpicture}')) {
		return source.replace(
			/\\begin\{tikzpicture\}/,
			`\\begin{tikzpicture}\n${gridLine}`,
		);
	}
	return `${gridLine}\n${source}`;
}

export function prepareGridForRender(source: string): string {
	const step = parseGridStep(source);
	if (!step) {
		return source;
	}
	const withoutDirective = source
		.split('\n')
		.filter(line => !isObsidianGridDirectiveLine(line))
		.join('\n');
	return injectGridIntoSource(withoutDirective, step);
}
