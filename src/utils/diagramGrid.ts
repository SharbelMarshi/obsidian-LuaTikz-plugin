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

function alreadyHasGrid(lines: string[]): boolean {
	const joined = lines.join('\n');
	return joined.includes('\\Grid(') || joined.includes('\\draw[step=');
}

/**
 * Where the generated grid line lands in the render source, or null when no
 * grid is drawn. Line-based on purpose: the error line map has to insert the
 * same synthetic slot, and a regex over the joined text could not agree.
 */
export function gridInjectionIndex(directiveSource: string, renderLines: string[]): number | null {
	if (!parseGridStep(directiveSource) || alreadyHasGrid(renderLines)) {
		return null;
	}
	const begin = renderLines.findIndex(line => line.includes('\\begin{tikzpicture}'));
	return begin === -1 ? 0 : begin + 1;
}

export function injectGridIntoSource(source: string, step: number): string {
	const lines = source.split('\n');
	const at = gridInjectionIndex(`grid=${step}`, lines);
	if (at === null) {
		return source;
	}
	// Inserted as a whole line, never spliced after the \begin{tikzpicture}
	// token — that would land in front of the environment's [options].
	lines.splice(at, 0, `\\draw[step=${step},gray!20,very thin] (0,0) grid (10,10);`);
	return lines.join('\n');
}

/**
 * Apply the `% grid=N` directive.
 *
 * The step is read from `directiveSource` (the tidied block, directives still
 * in place) but injected into `renderSource` (directives already stripped).
 * Reading both from the stripped text is why the grid never actually rendered:
 * stripDiagramAlignDirective removes the very line parseGridStep looks for.
 */
export function applyGridDirective(directiveSource: string, renderSource: string): string {
	const step = parseGridStep(directiveSource);
	if (!step) {
		return renderSource;
	}
	return injectGridIntoSource(renderSource, step);
}
