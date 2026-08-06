import type { Editor } from 'obsidian';
import { createNoteLineMapper, buildLatexErrorTitle } from './latexErrorMapping';
import type { TikzBlock } from '../core/types';
import type { LatexAutofix } from './latexAutofix';

export interface OptionEqualIssue {
	key: string;
	kind: 'empty' | 'invalid';
	value?: string;
	columnStart: number;
	columnEnd: number;
}

const KNOWN_ENUM_OPTIONS: Record<string, readonly string[]> = {
	align: ['left', 'center', 'right'],
};

/**
 * What to put after `key=` when the value was left blank. Only keys whose
 * TikZ default is unambiguous belong here — a wrong guess compiles into a
 * silently wrong diagram, which is worse than the error the user already sees.
 * Anything absent gets no Fix button at all rather than a button that does
 * nothing when clicked.
 */
const EMPTY_VALUE_DEFAULTS: Record<string, string> = {
	align: 'center',
	anchor: 'center',
	opacity: '1',
	'fill opacity': '1',
	'draw opacity': '1',
	'text opacity': '1',
	scale: '1',
	'xscale': '1',
	'yscale': '1',
	rotate: '0',
	xshift: '0cm',
	yshift: '0cm',
	'line width': '1pt',
	'inner sep': '2pt',
	'outer sep': '0pt',
	'minimum size': '1cm',
	'minimum width': '1cm',
	'minimum height': '1cm',
	'rounded corners': '2pt',
	draw: 'black',
	fill: 'white',
	text: 'black',
	'text width': '3cm',
	step: '1',
};

const OPTION_KEY_EQ_RE = /([a-zA-Z][\w\s.-]*?)\s*=/g;

export function findOptionEqualIssues(line: string): OptionEqualIssue[] {
	const codePart = line.replace(/%.*/, '');
	const issues: OptionEqualIssue[] = [];

	for (const match of codePart.matchAll(OPTION_KEY_EQ_RE)) {
		const key = match[1].trim();
		const columnStart = match.index ?? 0;
		const eqEnd = columnStart + match[0].length;
		const rest = codePart.slice(eqEnd);
		const valueMatch = rest.match(/^\s*([^,)\]}]*)/);
		const rawValue = valueMatch?.[1] ?? '';
		const value = rawValue.trim();
		const columnEnd = value ? eqEnd + (valueMatch?.[0].length ?? 0) : eqEnd;

		if (!value) {
			issues.push({ key, kind: 'empty', columnStart, columnEnd });
			continue;
		}

		const enumValues = KNOWN_ENUM_OPTIONS[key.toLowerCase()];
		if (enumValues && !enumValues.includes(value.toLowerCase())) {
			issues.push({
				key,
				kind: 'invalid',
				value,
				columnStart,
				columnEnd,
			});
		}
	}

	return issues;
}

export interface TikzSourceValidationError {
	summary: string;
	message: string;
	userLine: number;
	noteLine?: number;
	lineContent: string;
	autofix?: LatexAutofix;
	markColumnStart: number;
	markColumnEnd: number;
}

function normalizeOptionKey(key: string): string {
	return key.trim().toLowerCase();
}

function buildAutofixForIssue(issue: OptionEqualIssue): LatexAutofix | undefined {
	const key = normalizeOptionKey(issue.key);

	if (issue.kind === 'invalid') {
		const enumValues = KNOWN_ENUM_OPTIONS[key];
		const fallback = enumValues ? EMPTY_VALUE_DEFAULTS[key] : undefined;
		if (!fallback) {
			return undefined;
		}
		return {
			kind: 'fill-option-value',
			label: `Set ${issue.key}=${fallback}`,
			optionKey: issue.key,
			optionValue: fallback,
		};
	}

	const value = EMPTY_VALUE_DEFAULTS[key];
	if (!value) {
		return undefined;
	}

	return {
		kind: 'fill-option-value',
		label: `Set ${issue.key}=${value}`,
		optionKey: issue.key,
		optionValue: value,
	};
}

function buildSummary(issue: OptionEqualIssue): string {
	if (issue.kind === 'empty') {
		return `Missing value for "${issue.key}"`;
	}

	if (normalizeOptionKey(issue.key) === 'align') {
		return `"align" must be left, center, or right`;
	}

	return `Invalid value for "${issue.key}"`;
}

export function validateTikzRenderSource(
	renderSource: string,
	block?: TikzBlock,
	editor?: Editor,
): TikzSourceValidationError | null {
	const lines = renderSource.split('\n');
	const noteLineMapper = block ? createNoteLineMapper(block, editor) : undefined;

	for (let index = 0; index < lines.length; index++) {
		const renderLine = index + 1;
		const issues = findOptionEqualIssues(lines[index]);
		if (issues.length === 0) {
			continue;
		}

		const issue = issues[0];
		const noteLine = noteLineMapper?.(renderLine) ?? undefined;
		const lineContent = noteLine !== undefined && editor
			? editor.getLine(noteLine - 1)?.trimEnd() ?? lines[index]
			: lines[index];
		const highlightSource = lineContent;
		const highlightIssues = findOptionEqualIssues(highlightSource);
		const highlightIssue = highlightIssues.find(candidate =>
			candidate.key === issue.key && candidate.kind === issue.kind,
		) ?? issue;
		const summary = buildSummary(issue);
		const autofix = buildAutofixForIssue(issue);

		return {
			summary,
			message: `Line ${renderLine}: ${summary}`,
			userLine: renderLine,
			noteLine,
			lineContent,
			autofix,
			markColumnStart: highlightIssue.columnStart,
			markColumnEnd: highlightIssue.columnEnd,
		};
	}

	return null;
}

export function validationErrorToRenderResult(
	error: TikzSourceValidationError,
): {
	ok: false;
	error: string;
	rawLog?: string;
	userLine: number;
	noteLine?: number;
	lineContent: string;
	autofix?: LatexAutofix;
	markColumnStart: number;
	markColumnEnd: number;
} {
	return {
		ok: false,
		error: buildLatexErrorTitle({
			summary: error.summary,
			message: error.message,
			userLine: error.userLine,
			noteLine: error.noteLine,
		}),
		rawLog: error.message,
		userLine: error.userLine,
		noteLine: error.noteLine,
		lineContent: error.lineContent,
		autofix: error.autofix,
		markColumnStart: error.markColumnStart,
		markColumnEnd: error.markColumnEnd,
	};
}
