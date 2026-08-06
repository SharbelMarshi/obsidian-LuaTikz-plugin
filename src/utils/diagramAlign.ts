import { isObsidianGridDirectiveLine } from './diagramGrid';

export type DiagramAlign = 'left' | 'center' | 'right';

const ALIGN_LINE_RE = /^\s*(?:%\s*)?align\s*[=:]\s*(left|center|right)\s*$/i;
const TIKZPICTURE_BEGIN_RE = /\\begin\{tikzpicture\}\s*\[([^\]]*)\]/;

function normalizeAlign(value: string): DiagramAlign {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'left' || normalized === 'right') {
		return normalized;
	}
	return 'center';
}

function parseAlignFromOptionList(options: string): DiagramAlign | null {
	for (const part of options.split(',')) {
		const match = part.trim().match(/^align\s*=\s*(left|center|right)$/i);
		if (match) {
			return normalizeAlign(match[1]);
		}
	}
	return null;
}

function parseAlignFromTikzpicture(source: string): DiagramAlign | null {
	const match = source.match(TIKZPICTURE_BEGIN_RE);
	if (!match) {
		return null;
	}
	return parseAlignFromOptionList(match[1]);
}

function stripAlignFromTikzpictureOptions(source: string): string {
	return source.replace(TIKZPICTURE_BEGIN_RE, (_full, options: string) => {
		const cleaned = options
			.split(',')
			.map(part => part.trim())
			.filter(part => part.length > 0 && !/^align\s*=\s*(left|center|right)$/i.test(part))
			.join(', ');
		if (!cleaned) {
			return '\\begin{tikzpicture}';
		}
		return `\\begin{tikzpicture}[${cleaned}]`;
	});
}

/** Read diagram block alignment from a directive line or tikzpicture options. */
export function parseDiagramAlign(source: string): DiagramAlign {
	for (const line of source.split('\n')) {
		const match = line.match(ALIGN_LINE_RE);
		if (match) {
			return normalizeAlign(match[1]);
		}
	}

	return parseAlignFromTikzpicture(source) ?? 'center';
}

/** True when this line is stripped before LaTeX/TikZJax render (e.g. `% align=left`, `% grid=1`). */
export function isObsidianOnlyDirectiveLine(line: string): boolean {
	const trimmed = line.trim();
	return ALIGN_LINE_RE.test(trimmed) || isObsidianGridDirectiveLine(trimmed);
}

/** Mirror prepareTikzRenderSource line-by-line; null = omitted from render source. */
export function prepareBlockLineForRender(line: string): string | null {
	const trimmed = line.replaceAll('&nbsp;', '').trim();
	if (!trimmed) {
		return null;
	}
	if (isObsidianOnlyDirectiveLine(trimmed)) {
		return null;
	}
	return stripAlignFromTikzpictureOptions(trimmed);
}

/** Remove diagram alignment directives before sending source to LaTeX/TikZJax. */
export function stripDiagramAlignDirective(source: string): string {
	return source
		.split('\n')
		.map(line => prepareBlockLineForRender(line))
		.filter((line): line is string => line !== null)
		.join('\n');
}

export function applyDiagramAlign(containerEl: HTMLElement, align: DiagramAlign): void {
	containerEl.removeClass(
		'luatikz-diagram-align-left',
		'luatikz-diagram-align-center',
		'luatikz-diagram-align-right',
	);
	containerEl.addClass(`luatikz-diagram-align-${align}`);
}
