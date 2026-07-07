import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { isInsideTikzEditingContext } from './tikzFenceContext';
import {
	computeOrthogonalClosePoint,
	formatTikzCoordinate,
	parseAllNumericCoordinates,
} from '../utils/coordinatePick';

const PATH_CMD_RE = /^\\(?:draw|path|fill|filldraw)\b/;
const CCYCLE_SUFFIX_RE = /ccycle\s*$/;

function maybeApplyOrthogonalCcycle(update: ViewUpdate): void {
	if (!update.docChanged) {
		return;
	}

	const { state, view } = update;
	const head = state.selection.main.head;
	if (!isInsideTikzEditingContext(state.doc, head)) {
		return;
	}

	const line = state.doc.lineAt(head);
	const offsetInLine = head - line.from;
	const textBeforeHead = line.text.slice(0, offsetInLine);
	if (!CCYCLE_SUFFIX_RE.test(textBeforeHead)) {
		return;
	}

	if (!PATH_CMD_RE.test(line.text)) {
		return;
	}

	const pathText = textBeforeHead.replace(CCYCLE_SUFFIX_RE, '');
	const spans = parseAllNumericCoordinates(pathText);
	if (spans.length < 3) {
		return;
	}

	const closePoint = computeOrthogonalClosePoint(spans.map(span => span.coord));
	if (!closePoint) {
		return;
	}

	const last = spans[spans.length - 1];
	const ccycleStart = offsetInLine - (textBeforeHead.match(CCYCLE_SUFFIX_RE)?.[0].length ?? 0);
	const formatted = formatTikzCoordinate(closePoint);

	view.dispatch({
		changes: [
			{ from: line.from + last.from, to: line.from + last.to, insert: formatted },
			{ from: line.from + ccycleStart, to: head, insert: 'cycle' },
		],
		selection: { anchor: line.from + ccycleStart + 'cycle'.length },
	});
}

export function tikzCcycleExtension(): Extension {
	return EditorView.updateListener.of(maybeApplyOrthogonalCcycle);
}
