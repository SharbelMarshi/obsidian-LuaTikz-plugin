import type { SourcePatch, SourceSpan } from './sceneTypes';

/**
 * Span-based, lossless source patching for the visual editor.
 *
 * Every patch's old span is interpreted against the same original source
 * string, so a batch of edits computed from one parse applies atomically with
 * no offset bookkeeping. Validation is strict: malformed or overlapping spans
 * reject the whole batch — dropping one edit is recoverable, silently
 * corrupting user source is not.
 */

export type ApplySourcePatchesResult =
	| { kind: 'success'; source: string }
	| { kind: 'invalid'; reason: 'invalid-span-order' | 'out-of-bounds' | 'overlapping' };

export function applySourcePatches(
	source: string,
	patches: readonly SourcePatch[],
): ApplySourcePatchesResult {
	if (!patches.length) {
		return { kind: 'success', source };
	}

	const sorted = [...patches].sort((left, right) => {
		if (left.oldSpan.from !== right.oldSpan.from) {
			return left.oldSpan.from - right.oldSpan.from;
		}
		return left.oldSpan.to - right.oldSpan.to;
	});

	// Validate the whole batch before touching anything.
	let previousEnd = 0;
	for (const patch of sorted) {
		const { from, to } = patch.oldSpan;
		if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
			return { kind: 'invalid', reason: 'invalid-span-order' };
		}
		if (from < 0 || to > source.length) {
			return { kind: 'invalid', reason: 'out-of-bounds' };
		}
		if (from < previousEnd) {
			return { kind: 'invalid', reason: 'overlapping' };
		}
		previousEnd = to;
	}

	const parts: string[] = [];
	let cursor = 0;
	for (const patch of sorted) {
		parts.push(source.slice(cursor, patch.oldSpan.from), patch.replacement);
		cursor = patch.oldSpan.to;
	}
	parts.push(source.slice(cursor));
	return { kind: 'success', source: parts.join('') };
}

/** Sorted, validated patches, or null when the batch is not applicable. */
export function normalizePatches(
	source: string,
	patches: readonly SourcePatch[],
): SourcePatch[] | null {
	const applied = applySourcePatches(source, patches);
	if (applied.kind !== 'success') {
		return null;
	}
	return [...patches].sort((a, b) => a.oldSpan.from - b.oldSpan.from);
}

export interface BodyPosition {
	/** 0-based line index within the fence body. */
	line: number;
	ch: number;
}

/** Map a body character offset to a 0-based body line/ch position. */
export function bodyOffsetToPosition(body: string, offset: number): BodyPosition {
	const clamped = Math.max(0, Math.min(offset, body.length));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < clamped; index++) {
		if (body[index] === '\n') {
			line++;
			lineStart = index + 1;
		}
	}
	return { line, ch: clamped - lineStart };
}

export function spanLength(span: SourceSpan): number {
	return span.to - span.from;
}
