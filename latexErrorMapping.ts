export interface MappedLatexError {
	message: string;
	userLine?: number;
	lineContent?: string;
	noteLine?: number;
}

const LATEX_LINE_PATTERN = /(?:^|\n)\s*l\.(\d+)/;

export function getUserSourceLineOffset(wrapperPrefix: string): number {
	if (!wrapperPrefix) {
		return 0;
	}

	return wrapperPrefix.split('\n').length;
}

export function parseLatexErrorLine(raw: string): number | null {
	const match = raw.match(LATEX_LINE_PATTERN);
	if (!match) {
		return null;
	}

	const line = parseInt(match[1], 10);
	return Number.isFinite(line) ? line : null;
}

export function extractUsefulLatexError(raw: string): string {
	const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

	const bangLine = lines.find(line => line.startsWith('! '));
	if (bangLine) {
		return bangLine.replace(/^!\s*/, '').trim();
	}

	const usefulLine = lines.find(line =>
		line.includes('Undefined control sequence') ||
		line.includes('Missing') ||
		line.includes('Runaway argument') ||
		line.includes('Fatal error')
	);

	if (usefulLine) {
		return usefulLine.trim();
	}

	return 'Syntax error';
}

export function mapTidiedLineToNoteLine(
	blockStartLine: number,
	blockEndLine: number,
	getLineText: (line: number) => string,
	tidiedLine: number,
): number | null {
	let nonEmptyIndex = 0;

	for (let line = blockStartLine + 1; line < blockEndLine; line++) {
		const text = getLineText(line).trim();
		if (!text) {
			continue;
		}

		nonEmptyIndex++;
		if (nonEmptyIndex === tidiedLine) {
			return line + 1;
		}
	}

	return null;
}

export function formatLatexErrorWithLineMapping(
	raw: string,
	tidiedSource: string,
	sourceLineOffset: number,
	noteLineMapper?: (userLine: number) => number | null,
): MappedLatexError {
	const usefulError = extractUsefulLatexError(raw);
	const latexLine = parseLatexErrorLine(raw);

	if (latexLine === null || latexLine <= sourceLineOffset) {
		return { message: usefulError };
	}

	const userLine = latexLine - sourceLineOffset;
	const sourceLines = tidiedSource.split('\n');
	const lineContent = sourceLines[userLine - 1]?.trim();
	const noteLine = noteLineMapper?.(userLine) ?? undefined;
	const snippet = lineContent
		? (lineContent.length > 80 ? `${lineContent.slice(0, 77)}...` : lineContent)
		: usefulError;

	if (noteLine !== undefined) {
		return {
			message: `Line ${noteLine}: ${snippet}`,
			userLine,
			lineContent,
			noteLine,
		};
	}

	return {
		message: `Line ${userLine}: ${snippet}`,
		userLine,
		lineContent,
	};
}
