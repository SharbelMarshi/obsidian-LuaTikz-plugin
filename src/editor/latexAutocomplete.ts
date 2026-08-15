import {
	autocompletion,
	Completion,
	CompletionContext,
	snippetCompletion,
} from '@codemirror/autocomplete';
import { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
	allSnippetCompletions,
	NODE_ANCHOR_SUFFIXES,
	snippetCompletionsForCategory,
	type TikzSnippetCategory,
} from '../latex/tikzSnippets';
import { parseTikzBlockContext } from '../latex/tikzBlockContext';
import { LATEX_FENCE_LANGUAGES, TIKZ_FENCE_LANGUAGES, enclosingFenceLine } from './tikzFences';

const latexCommands: Completion[] = [
	snippetCompletion('\\begin{tikzpicture}\n${}\n\\end{tikzpicture}', {
		label: '\\begin{tikzpicture}',
		type: 'keyword',
		detail: 'TikZ environment',
	}),
	{
		label: '\\end{tikzpicture}',
		type: 'keyword',
		apply: '\\end{tikzpicture}',
		detail: 'End TikZ environment',
	},
	snippetCompletion('\\begin{axis}\n${}\n\\end{axis}', {
		label: '\\begin{axis}',
		type: 'keyword',
		detail: 'Pgfplots axis environment',
	}),
	{
		label: '\\end{axis}',
		type: 'keyword',
		apply: '\\end{axis}',
		detail: 'End axis environment',
	},
	{ label: '\\draw', type: 'function', apply: '\\draw ', detail: 'TikZ draw command' },
	{ label: '\\fill', type: 'function', apply: '\\fill ', detail: 'Fill a path' },
	{ label: '\\node', type: 'function', apply: '\\node ', detail: 'TikZ node command' },
	{ label: '\\path', type: 'function', apply: '\\path ', detail: 'TikZ path without drawing' },
	snippetCompletion('\\foreach \\x in {1,...,5} {\n  ${}\n}', { label: '\\foreach', type: 'function', detail: 'Loop over values' }),
	snippetCompletion('\\usetikzlibrary{${}}', {
		label: '\\usetikzlibrary',
		type: 'function',
		detail: 'Load TikZ library',
	}),
	snippetCompletion('\\addplot {${}};', {
		label: '\\addplot',
		type: 'function',
		detail: 'PGFPlots plot command',
	}),
];

const greekLetters: Completion[] = [
	'\\alpha', '\\beta', '\\gamma', '\\delta', '\\theta', '\\lambda', '\\pi', '\\sigma', '\\omega',
].map(label => ({ label, type: 'variable' as const, apply: label, detail: 'Greek letter' }));

const tikzOptions: Completion[] = [
	{ label: '% align=left', type: 'keyword', apply: '% align=left\n', detail: 'Align diagram block left' },
	{ label: '% align=center', type: 'keyword', apply: '% align=center\n', detail: 'Align diagram block center' },
	{ label: '% align=right', type: 'keyword', apply: '% align=right\n', detail: 'Align diagram block right' },
	{ label: '% grid=1', type: 'keyword', apply: '% grid=1\n', detail: 'Show 1cm background grid' },
	{ label: '->', type: 'property', apply: '->', detail: 'Arrow tip' },
	{ label: 'thick', type: 'property', apply: 'thick', detail: 'Thick line' },
	{ label: 'dashed', type: 'property', apply: 'dashed', detail: 'Dashed line' },
	{ label: 'grid=major', type: 'property', apply: 'grid=major', detail: 'PGFPlots major grid' },
	{ label: 'xlabel=', type: 'property', apply: 'xlabel={}', detail: 'PGFPlots x-axis label' },
	{ label: 'ylabel=', type: 'property', apply: 'ylabel={}', detail: 'PGFPlots y-axis label' },
	{ label: 'domain=', type: 'property', apply: 'domain=0:10', detail: 'PGFPlots domain' },
];

const axisOptions: Completion[] = [
	{ label: 'xlabel=', type: 'property', apply: 'xlabel={}', detail: 'X axis label' },
	{ label: 'ylabel=', type: 'property', apply: 'ylabel={}', detail: 'Y axis label' },
	{ label: 'domain=', type: 'property', apply: 'domain=0:10', detail: 'Plot domain' },
	{ label: 'samples=', type: 'property', apply: 'samples=100', detail: 'Sample count' },
	{ label: 'grid=major', type: 'property', apply: 'grid=major', detail: 'Major grid lines' },
];

const tikzLibraries: Completion[] = [
	{ label: 'arrows.meta', type: 'text', apply: 'arrows.meta', detail: 'Arrow tips' },
	{ label: 'positioning', type: 'text', apply: 'positioning', detail: 'Relative positioning' },
	{ label: 'calc', type: 'text', apply: 'calc', detail: 'Coordinate calculations' },
	{ label: 'shapes.gates.logic.US', type: 'text', apply: 'shapes.gates.logic.US', detail: 'Logic gates' },
	{ label: 'pgfplots', type: 'text', apply: 'pgfplots', detail: 'Plotting (via package)' },
];

const allCommandCompletions = [
	...latexCommands,
	...allSnippetCompletions(),
	...greekLetters,
];

/** Block body from the opening fence to the cursor, or '' when not in one. */
function tikzBlockSourceBeforeCursor(doc: EditorView['state']['doc'], pos: number): string {
	const fenceLine = enclosingFenceLine(doc, pos, TIKZ_FENCE_LANGUAGES);
	if (fenceLine === null) {
		return '';
	}
	const contentFrom = doc.line(fenceLine).to + 1;
	return contentFrom <= pos ? doc.sliceString(contentFrom, pos) : '';
}

function filterCompletions(options: Completion[], prefix: string): Completion[] {
	const lowerPrefix = prefix.toLowerCase();
	return options.filter(option => option.label.toLowerCase().startsWith(lowerPrefix));
}

function nodeAnchorCompletions(ctx: ReturnType<typeof parseTikzBlockContext>, prefix: string): Completion[] {
	const options: Completion[] = [];
	for (const name of ctx.nodeNames) {
		for (const suffix of NODE_ANCHOR_SUFFIXES) {
			const label = `${name}${suffix}`;
			if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
				options.push({
					label,
					type: 'variable',
					apply: label,
					detail: `Anchor on node ${name}`,
				});
			}
		}
	}
	return options;
}

function logicWireCompletions(ctx: ReturnType<typeof parseTikzBlockContext>, prefix: string): Completion[] {
	return ctx.nodeNames
		.filter(name => name.toLowerCase().startsWith(prefix.toLowerCase()))
		.map(name => ({
			label: name,
			type: 'variable' as const,
			apply: name,
			detail: 'Defined node',
		}));
}

function contextualCompletions(blockSource: string, explicit: boolean): Completion[] {
	const ctx = parseTikzBlockContext(blockSource);
	if (ctx.insideAxis) {
		return [...axisOptions, ...snippetCompletionsForCategory('plot')];
	}
	if (explicit && blockSource.trim().length === 0) {
		return snippetCompletionsForCategory('shape');
	}
	return [];
}

function latexCompletionSource(context: CompletionContext) {
	if (enclosingFenceLine(context.state.doc, context.pos, LATEX_FENCE_LANGUAGES) === null) {
		return null;
	}

	const blockSource = tikzBlockSourceBeforeCursor(context.state.doc, context.pos);
	const ctx = parseTikzBlockContext(blockSource);

	const parenMatch = context.matchBefore(/\([^)]*/);
	if (parenMatch && parenMatch.text.startsWith('(')) {
		const prefix = parenMatch.text.slice(1);
		const beforeParen = context.state.doc.sliceString(Math.max(0, parenMatch.from - 20), parenMatch.from);
		if (/\\LogicWire[A-Za-z]*$/.test(beforeParen)) {
			return {
				from: parenMatch.from + 1,
				options: logicWireCompletions(ctx, prefix),
				validFor: /^[^)]*$/,
			};
		}
		return {
			from: parenMatch.from + 1,
			options: nodeAnchorCompletions(ctx, prefix),
			validFor: /^[^)]*$/,
		};
	}

	const commandMatch = context.matchBefore(/\\(?:[A-Za-z]+|\{)?/);
	if (commandMatch) {
		const prefix = commandMatch.text;
		const contextual = contextualCompletions(blockSource, context.explicit);
		const options = filterCompletions(
			[...allCommandCompletions, ...contextual],
			prefix,
		);
		return {
			from: commandMatch.from,
			options,
			validFor: /^\\(?:[A-Za-z]+|\{)?$/,
		};
	}

	const libraryMatch = context.matchBefore(/\\usetikzlibrary\{[^}]*\}?/);
	if (libraryMatch) {
		const openBrace = libraryMatch.text.indexOf('{');
		if (openBrace !== -1) {
			const prefix = libraryMatch.text.slice(openBrace + 1).replace(/}$/, '');
			const from = libraryMatch.from + openBrace + 1;
			return {
				from,
				options: filterCompletions(tikzLibraries, prefix),
				validFor: /^[^}]*$/,
			};
		}
	}

	const bracketOptionMatch = context.matchBefore(/(?:^|[[\s,{])([A-Za-z!\\=0-9.<>-]+)?/);
	if (bracketOptionMatch) {
		const prefix = bracketOptionMatch.text.replace(/^[[\s,{]+/, '');
		const charBefore = context.state.doc.sliceString(
			Math.max(0, context.pos - 1),
			context.pos,
		);

		const optionPool = ctx.insideAxis
			? [...tikzOptions, ...axisOptions]
			: tikzOptions;

		if (prefix.length > 0 || charBefore === '[' || charBefore === ',' || context.explicit) {
			return {
				from: context.pos - prefix.length,
				options: filterCompletions(optionPool, prefix),
				validFor: /^[A-Za-z!\\=0-9.<>-]*$/,
			};
		}
	}

	if (context.explicit && blockSource.trim().length === 0) {
		return {
			from: context.pos,
			options: snippetCompletionsForCategory('shape'),
			validFor: /^$/,
		};
	}

	return null;
}

/**
 * TikZ completions, registered as *language data* rather than through
 * `autocompletion({override})`.
 *
 * `override` is doubly wrong here. Semantically it does not add a source, it
 * replaces every source in the editor — for all files, not just TikZ fences —
 * so it silently suppressed other plugins' completions. Mechanically it is a
 * config field with no merge rule in CodeMirror's `combineConfig`, and its
 * value is a fresh array, so a second plugin that also passes `override`
 * makes facet resolution throw "Config merge conflict for field override".
 * That throw happens inside `registerEditorExtension` during `onload`, which
 * Obsidian reports as the whole plugin failing to load.
 *
 * Language-data providers are additive: CodeMirror falls back to
 * `state.languageDataAt("autocomplete", pos)` when no override is present,
 * and any number of providers coexist. `latexCompletionSource` already
 * returns null outside a LaTeX/TikZ fence, so registering it document-wide
 * costs nothing elsewhere.
 *
 * `autocompletion()` is called with no config on purpose: every field
 * (`maxRenderedOptions`, `activateOnTyping`, …) is a potential merge conflict
 * with another plugin's call, and the defaults are what this plugin wants.
 */
export function latexAutocompleteExtension(): Extension {
	return [
		EditorState.languageData.of(() => [{ autocomplete: latexCompletionSource }]),
		autocompletion(),
	];
}

export function getCategoryCompletions(category: TikzSnippetCategory): Completion[] {
	return snippetCompletionsForCategory(category);
}
