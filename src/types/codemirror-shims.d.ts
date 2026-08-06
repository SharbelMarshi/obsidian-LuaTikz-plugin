declare module '@codemirror/lint' {
	import type { Extension } from '@codemirror/state';
	import type { EditorView } from '@codemirror/view';

	export interface Diagnostic {
		from: number;
		to: number;
		severity: 'hint' | 'info' | 'warning' | 'error';
		message: string;
		actions?: Array<{
			name: string;
			apply(view: EditorView, from: number, to: number): void;
		}>;
	}

	export function linter(
		source: (view: EditorView) => readonly Diagnostic[],
	): Extension;
}

declare module '@codemirror/closebrackets' {
	import type { Extension } from '@codemirror/state';
	export function closeBrackets(): Extension;
}

declare module '@codemirror/commands' {
	import type { AnnotationType } from '@codemirror/state';
	/**
	 * History-isolation annotation: dispatching a transaction with
	 * `isolateHistory.of('full')` keeps it from merging with neighboring
	 * changes into one undo step. Provided by Obsidian at runtime.
	 */
	export const isolateHistory: AnnotationType<'before' | 'after' | 'full'>;
}
