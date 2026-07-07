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
