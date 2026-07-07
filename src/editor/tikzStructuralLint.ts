import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { parseTikzBlockContext, allLibrariesNeeded } from '../latex/tikzBlockContext';

const OPEN_FENCE_RE = /^```(?:tikz|luatikz)\b.*$/;
const BEGIN_ENV_RE = /\\begin\{([^}]+)\}/g;
const END_ENV_RE = /\\end\{([^}]+)\}/g;
const EMPTY_KEY_RE = /(?:^|[\s,{])([A-Za-z!-]+)=\s*(?=[,\]]|$)/;

function findTikzBlocks(doc: Text): { from: number; to: number; source: string }[] {
	const blocks: { from: number; to: number; source: string }[] = [];
	let openLine: number | null = null;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		const trimmed = line.text.trim();

		if (openLine === null) {
			if (OPEN_FENCE_RE.test(trimmed)) {
				openLine = lineNumber;
			}
			continue;
		}

		if (trimmed === '```') {
			const contentStart = openLine + 1;
			const contentEnd = lineNumber - 1;
			if (contentEnd >= contentStart) {
				const from = doc.line(contentStart).from;
				const to = doc.line(contentEnd).to;
				blocks.push({ from, to, source: doc.sliceString(from, to) });
			}
			openLine = null;
		}
	}

	return blocks;
}

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
			envStack.push({ env: match[1], line: i, from: lineFrom + match.index! });
		}

		for (const match of line.matchAll(END_ENV_RE)) {
			const env = match[1];
			const idx = envStack.map(entry => entry.env).lastIndexOf(env);
			if (idx === -1) {
				diagnostics.push({
					from: lineFrom + match.index!,
					to: lineFrom + match.index! + match[0].length,
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

		for (const match of line.matchAll(EMPTY_KEY_RE)) {
			diagnostics.push({
				from: lineFrom + match.index!,
				to: lineFrom + match.index! + match[0].length,
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

export function tikzStructuralLintExtension(getEnabled: () => boolean): Extension {
	return linter((view: EditorView) => {
		if (!getEnabled()) {
			return [];
		}

		const diagnostics: Diagnostic[] = [];
		for (const block of findTikzBlocks(view.state.doc)) {
			diagnostics.push(...lintBlockSource(block.source, block.from));
		}
		return diagnostics;
	});
}
