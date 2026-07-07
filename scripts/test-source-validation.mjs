import assert from 'node:assert/strict';

const KNOWN_ENUM_OPTIONS = {
	align: ['left', 'center', 'right'],
};

const OPTION_KEY_EQ_RE = /([a-zA-Z][\w\s.-]*?)\s*=/g;

function findOptionEqualIssues(line) {
	const codePart = line.replace(/%.*/, '');
	const issues = [];

	for (const match of codePart.matchAll(OPTION_KEY_EQ_RE)) {
		const key = match[1].trim();
		const columnStart = match.index ?? 0;
		const eqEnd = columnStart + match[0].length;
		const rest = codePart.slice(eqEnd);
		const valueMatch = rest.match(/^\s*([^,\]\}\)]*)/);
		const rawValue = valueMatch?.[1] ?? '';
		const value = rawValue.trim();
		const columnEnd = value ? eqEnd + valueMatch[0].length : eqEnd;

		if (!value) {
			issues.push({ key, kind: 'empty', columnStart, columnEnd });
			continue;
		}

		const enumValues = KNOWN_ENUM_OPTIONS[key.toLowerCase()];
		if (enumValues && !enumValues.includes(value.toLowerCase())) {
			issues.push({ key, kind: 'invalid', value, columnStart, columnEnd });
		}
	}

	return issues;
}

const emptyAlign = findOptionEqualIssues('\\begin{tikzpicture}[align=]');
assert.equal(emptyAlign.length, 1);
assert.equal(emptyAlign[0].key, 'align');
assert.equal(emptyAlign[0].kind, 'empty');

const emptyOpacity = findOptionEqualIssues('\\node[opacity=, draw] {x};');
assert.equal(emptyOpacity.length, 1);
assert.equal(emptyOpacity[0].key, 'opacity');

const valid = findOptionEqualIssues('\\node[align=center, opacity=0.5] {x};');
assert.equal(valid.length, 0);

const trailingEmpty = findOptionEqualIssues('\\draw[line width=] (0,0)--(1,1);');
assert.equal(trailingEmpty.length, 1);
assert.equal(trailingEmpty[0].key, 'line width');

const spacedKey = findOptionEqualIssues('\\node[minimum width=] {};');
assert.equal(spacedKey.length, 1);
assert.equal(spacedKey[0].key, 'minimum width');

const invalidAlign = findOptionEqualIssues('\\node[align=top] {};');
assert.equal(invalidAlign.length, 1);
assert.equal(invalidAlign[0].kind, 'invalid');
assert.equal(invalidAlign[0].value, 'top');

console.log('test-source-validation: ok');
