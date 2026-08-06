import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { parseTikzBlockContext, allLibrariesNeeded } from '../latex/tikzBlockContext';
import { normalizeUserLibraryCommand } from '../core/tikzSource';
import { findFencedTikzRanges } from './tikzFences';

const USETIKZLIBRARY_RE = /\\usetikzlibrary\s*\{[^}]*\}/g;
const BEGIN_ENV_RE = /\\begin\{([^}]+)\}/g;
const END_ENV_RE = /\\end\{([^}]+)\}/g;
// `[` belongs in the prefix class: `\node[align=]` — the most common shape —
// was never flagged because the key sits right after the opening bracket.
const EMPTY_KEY_RE = /(?:^|[\s,{[])([A-Za-z!-]+)=\s*(?=[,\]]|$)/g;

function lintBlockSource(source: string, blockFrom: number): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const lines = source.split('\n');
	const envStack: { env: string; line: number; from: number }[] = [];

	let offset = blockFrom;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineFrom = offset;
		const trimmed = line.trim();

		if (trimmed.startsWith('%')) {
			offset += line.length + 1;
			continue;
		}

		for (const match of line.matchAll(BEGIN_ENV_RE)) {
			const matchIndex = match.index ?? 0;
			envStack.push({ env: match[1], line: i, from: lineFrom + matchIndex });
		}

		for (const match of line.matchAll(END_ENV_RE)) {
			const env = match[1];
			const matchIndex = match.index ?? 0;
			const idx = envStack.map(entry => entry.env).lastIndexOf(env);
			if (idx === -1) {
				diagnostics.push({
					from: lineFrom + matchIndex,
					to: lineFrom + matchIndex + match[0].length,
					severity: 'warning',
					message: `Unmatched \\end{${env}}`,
				});
			} else {
				envStack.splice(idx, 1);
			}
		}

		let braceDepth = 0;
		for (const ch of line) {
			if (ch === '{') braceDepth++;
			if (ch === '}') braceDepth--;
		}
		if (braceDepth < 0) {
			diagnostics.push({
				from: lineFrom,
				to: lineFrom + line.length,
				severity: 'warning',
				message: 'Unmatched closing brace',
			});
		} else if (braceDepth > 0 && !trimmed.endsWith('{')) {
			diagnostics.push({
				from: lineFrom,
				to: lineFrom + line.length,
				severity: 'hint',
				message: 'Unclosed brace on this line',
			});
		}

		const openBracket = line.indexOf('[');
		const closeBracket = line.lastIndexOf(']');
		if (openBracket !== -1 && (closeBracket === -1 || closeBracket < openBracket)) {
			diagnostics.push({
				from: lineFrom + openBracket,
				to: lineFrom + line.length,
				severity: 'hint',
				message: 'Unclosed option bracket [',
			});
		}

		// TikZ aborts the whole compile on an unknown library name, so LuaTikz
		// rewrites these before compiling; say so rather than dropping silently.
		for (const match of line.matchAll(USETIKZLIBRARY_RE)) {
			const rewritten = normalizeUserLibraryCommand(match[0]);
			if (rewritten.length === 1 && rewritten[0] === match[0]) {
				continue;
			}
			const matchIndex = match.index ?? 0;
			const replacement = rewritten.join('\n');
			diagnostics.push({
				from: lineFrom + matchIndex,
				to: lineFrom + matchIndex + match[0].length,
				severity: 'warning',
				message: replacement
					? `Not all of these are TikZ libraries — LuaTikz compiles this as: ${replacement.replace(/\n/g, ' ')}`
					: 'Not a TikZ library — LuaTikz already loads this package, so the line has no effect.',
				actions: [{
					name: replacement ? 'Rewrite' : 'Remove',
					apply(view: EditorView, from: number, to: number) {
						view.dispatch({ changes: { from, to, insert: replacement } });
					},
				}],
			});
		}

		for (const match of line.matchAll(EMPTY_KEY_RE)) {
			// Anchor on the key itself, not match.index: the match starts at
			// the separator character before the key, so the squiggle sat one
			// column early.
			const keyStart = (match.index ?? 0) + match[0].indexOf(match[1]);
			diagnostics.push({
				from: lineFrom + keyStart,
				to: lineFrom + keyStart + match[1].length + 1,
				severity: 'warning',
				message: `Empty option key "${match[1]}"`,
			});
		}

		offset += line.length + 1;
	}

	for (const unclosed of envStack) {
		diagnostics.push({
			from: unclosed.from,
			to: unclosed.from + `\\begin{${unclosed.env}}`.length,
			severity: 'warning',
			message: `Unclosed \\begin{${unclosed.env}}`,
		});
	}

	const ctx = parseTikzBlockContext(source);
	if (ctx.insideAxis && !/\\pgfplotsset\{[^}]*compat\s*=/.test(source)) {
		diagnostics.push({
			from: blockFrom,
			to: blockFrom + Math.min(source.length, 40),
			severity: 'hint',
			message: 'Consider \\pgfplotsset{compat=1.18} for PGFPlots',
		});
	}

	const missingLibs = allLibrariesNeeded(source);
	if (missingLibs.length > 0) {
		diagnostics.push({
			from: blockFrom,
			to: blockFrom + Math.min(source.length, 20),
			severity: 'hint',
			message: `Missing library: ${missingLibs.join(', ')}`,
			actions: [{
				name: 'Insert \\usetikzlibrary',
				apply(view: EditorView, from: number) {
					const insert = `\\usetikzlibrary{${missingLibs.join(',')}}\n`;
					view.dispatch({ changes: { from, insert } });
				},
			}],
		});
	}

	return diagnostics;
}

/** The whole lint pass as a pure function of the document — what the tests call. */
export function lintMarkdownDoc(doc: Text, enabled: boolean): Diagnostic[] {
	if (!enabled) {
		return [];
	}

	const diagnostics: Diagnostic[] = [];
	for (const block of findFencedTikzRanges(doc)) {
		diagnostics.push(...lintBlockSource(block.source, block.from));
	}
	return diagnostics;
}

export function tikzStructuralLintExtension(getEnabled: () => boolean): Extension {
	return linter((view: EditorView) => lintMarkdownDoc(view.state.doc, getEnabled()));
}
