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

const OPTION_KEY_EQ_RE = /([a-zA-Z][\w\s.-]*?)\s*=/g;

export function findOptionEqualIssues(line: string): OptionEqualIssue[] {
	const codePart = line.replace(/%.*/, '');
	const issues: OptionEqualIssue[] = [];

	for (const match of codePart.matchAll(OPTION_KEY_EQ_RE)) {
		const key = match[1].trim();
		const columnStart = match.index ?? 0;
		const eqEnd = columnStart + match[0].length;
		const rest = codePart.slice(eqEnd);
		const valueMatch = rest.match(/^\s*([^,\]\}\)]*)/);
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

	if (issue.kind === 'empty' && key === 'align') {
		return {
			kind: 'fill-option-value',
			label: 'Set align=center',
			optionKey: issue.key,
			optionValue: 'center',
		};
	}

	if (issue.kind === 'invalid' && key === 'align') {
		return {
			kind: 'fill-option-value',
			label: 'Set align=center',
			optionKey: issue.key,
			optionValue: 'center',
		};
	}

	if (issue.kind === 'empty') {
		return {
			kind: 'fill-option-value',
			label: `Add value after ${issue.key}=`,
			optionKey: issue.key,
			optionValue: '?',
		};
	}

	return undefined;
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
	errorSummary: string;
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
		errorSummary: error.summary,
		rawLog: error.message,
		userLine: error.userLine,
		noteLine: error.noteLine,
		lineContent: error.lineContent,
		autofix: error.autofix,
		markColumnStart: error.markColumnStart,
		markColumnEnd: error.markColumnEnd,
	};
}
