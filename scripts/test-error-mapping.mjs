import assert from 'node:assert/strict';

function humanizeLatexError(rawLine) {
	const trimmed = rawLine.replace(/^!\s*/, '').trim();
	const lower = trimmed.toLowerCase();
	if (lower.includes('missing ;')) {
		return 'Missing semicolon (;)';
	}
	if (lower.includes('forgot a semicolon') || lower.includes('giving up on this path')) {
		return 'Missing semicolon (;)';
	}
	if (lower.startsWith('missing $ inserted')) {
		return 'Missing $ inserted';
	}
	if (lower.startsWith('missing } inserted')) {
		return 'Missing closing brace }';
	}
	return trimmed;
}

function extractUsefulLatexError(raw) {
	const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	const bangLine = lines.find(line => line.startsWith('! '));
	if (bangLine) {
		return humanizeLatexError(bangLine);
	}
	return 'Syntax error';
}

function buildLatexErrorTitle(mapped) {
	const displayLine = mapped.userLine ?? mapped.noteLine;
	if (displayLine !== undefined) {
		return `${mapped.summary} (line ${displayLine})`;
	}
	return mapped.summary;
}

function braceBalance(line) {
	let depth = 0;
	let escaped = false;
	for (const ch of line) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		if (ch === '{') depth++;
		if (ch === '}') depth--;
	}
	return depth;
}

function suggestLatexAutofix(summary, lineContent, rawLog) {
	const haystack = [summary, rawLog ?? ''].join('\n').toLowerCase();
	if (!lineContent?.trim()) {
		return null;
	}
	const trimmedLine = lineContent.trimEnd();
	if (haystack.includes('missing ;') && !trimmedLine.endsWith(';')) {
		return { kind: 'append-semicolon', label: 'Add missing semicolon (;)' };
	}
	if ((haystack.includes('forgot a semicolon') || haystack.includes('giving up on this path'))
		&& !trimmedLine.endsWith(';')) {
		return { kind: 'append-semicolon', label: 'Add missing semicolon (;)' };
	}
	if (haystack.includes('missing }') && braceBalance(trimmedLine) > 0) {
		return { kind: 'append-closing-brace', label: 'Add missing closing brace (})' };
	}
	if (haystack.includes('missing $') && (trimmedLine.split('$').length - 1) % 2 === 1) {
		return { kind: 'append-math-delimiter', label: 'Add missing math delimiter ($)' };
	}
	if (/\\begn\{tikzpicture\}/.test(lineContent)) {
		return { kind: 'fix-typo', label: 'Fix \\begin{tikzpicture} typo' };
	}
	return null;
}

const sampleLog = `! Missing ; inserted.
<inserted text>
                ;
l.37 \\draw (0,0) -- (1,1)
`;

const summary = extractUsefulLatexError(sampleLog);
assert.equal(summary, 'Missing semicolon (;)');

const title = buildLatexErrorTitle({ summary, userLine: 4, noteLine: 37 });
assert.equal(
	title,
	'Missing semicolon (;) (line 4)',
);

const semicolonFix = suggestLatexAutofix(summary, '\\draw (0,0) -- (1,1)', sampleLog);
assert.ok(semicolonFix);
assert.equal(semicolonFix.kind, 'append-semicolon');

const braceFix = suggestLatexAutofix(
	'Missing closing brace }',
	'\\node {foo',
	'! Missing } inserted.',
);
assert.ok(braceFix);
assert.equal(braceFix.kind, 'append-closing-brace');

const typoFix = suggestLatexAutofix(
	'Undefined control sequence',
	'\\begn{tikzpicture}',
	'',
);
assert.ok(typoFix);
assert.equal(typoFix.kind, 'fix-typo');

const pgfSemicolonLog = `! Package tikz Error: Giving up on this path. Did you forget a semicolon?.
l.4 \\coordinate (C) at (3.0,1.15)
`;
const pgfSummary = extractUsefulLatexError(pgfSemicolonLog);
assert.equal(pgfSummary, 'Missing semicolon (;)');
const pgfFix = suggestLatexAutofix(pgfSummary, '\\coordinate (C) at (3.0,1.15)', pgfSemicolonLog);
assert.ok(pgfFix);
assert.equal(pgfFix.kind, 'append-semicolon');

console.log('test-error-mapping: ok');
