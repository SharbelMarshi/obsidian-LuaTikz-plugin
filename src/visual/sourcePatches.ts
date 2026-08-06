import type { SourcePatch, SourceSpan } from './sceneTypes';

/**
 * Span-based, lossless source patching.
 *
 * Adapted from the tikz-editor project by Dominik Peters
 * (https://github.com/DominikPeters/tikz-editor,
 * packages/core/src/edit/source-patches.ts), MIT License,
 * Copyright (c) 2026 Dominik Peters. See THIRD-PARTY-NOTICES.md.
 *
 * All old spans are interpreted against the same original source string, so a
 * batch of edits computed from one parse can be applied atomically without
 * offset bookkeeping. Overlapping patches are rejected rather than guessed at:
 * a wrong merge would corrupt user source, a rejection just drops one edit.
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

	let cursor = 0;
	let output = '';
	for (const patch of sorted) {
		const { from, to } = patch.oldSpan;
		if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
			return { kind: 'invalid', reason: 'invalid-span-order' };
		}
		if (from < 0 || to > source.length) {
			return { kind: 'invalid', reason: 'out-of-bounds' };
		}
		if (from < cursor) {
			return { kind: 'invalid', reason: 'overlapping' };
		}
		output += source.slice(cursor, from);
		output += patch.replacement;
		cursor = to;
	}
	output += source.slice(cursor);
	return { kind: 'success', source: output };
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
