import type { EditorView } from '@codemirror/view';

/** True when `pos` is inside an open ```tikz / ```luatikz fence (before closing ```). */
export function isInsideTikzFence(doc: EditorView['state']['doc'], pos: number): boolean {
	const textBefore = doc.sliceString(0, pos);
	const fencePattern = /```(?:tikz|luatikz)\b[^\n]*\n/g;
	let lastOpen = -1;
	let match: RegExpExecArray | null;
	while ((match = fencePattern.exec(textBefore)) !== null) {
		lastOpen = match.index + match[0].length;
	}
	if (lastOpen === -1) {
		return false;
	}
	const afterOpen = textBefore.slice(lastOpen);
	for (const line of afterOpen.split('\n')) {
		if (line.trim() === '```') {
			return false;
		}
	}
	return true;
}

/** True inside a ```tikz fence or an open `\\begin{tikzpicture}` … `\\end{tikzpicture}` block. */
export function isInsideTikzEditingContext(doc: EditorView['state']['doc'], pos: number): boolean {
	if (isInsideTikzFence(doc, pos)) {
		return true;
	}

	const textBefore = doc.sliceString(0, pos);
	let depth = 0;
	const envRe = /\\(?:begin|end)\{tikzpicture\}/g;
	let match: RegExpExecArray | null;
	while ((match = envRe.exec(textBefore)) !== null) {
		if (match[0].startsWith('\\begin')) {
			depth++;
		} else {
			depth = Math.max(0, depth - 1);
		}
	}
	return depth > 0;
}
