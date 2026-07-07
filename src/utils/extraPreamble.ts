/** Split user extra preamble for LuaLaTeX (full) vs TikZJax (compatible subset). */

const LUALATEX_ONLY_LINE_PATTERNS: RegExp[] = [
	/^\\usepackage(?:\[[^\]]*\])?\{fontspec\}\s*$/i,
	/^\\usepackage(?:\[[^\]]*\])?\{polyglossia\}\s*$/i,
	/^\\usepackage(?:\[[^\]]*\])?\{unicode-math\}\s*$/i,
	/^\\setmainlanguage\{[^}]+\}\s*$/i,
	/^\\setotherlanguage\{[^}]+\}\s*$/i,
	/^\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}\s*$/i,
	/^\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}\s*$/i,
	/^\\setmonofont(?:\[[^\]]*\])?\{[^}]+\}\s*$/i,
	/^\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}\s*$/i,
];

const REDEFINE_RTL_MACRO = /^\\newcommand\{\\(?:he|ar)\}/;

export interface ExtraPreambleSplit {
	lualatex: string;
	tikzjax: string;
	removedForTikzJax: string[];
}

function isLuaLatexOnlyLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) {
		return false;
	}
	return LUALATEX_ONLY_LINE_PATTERNS.some(pattern => pattern.test(trimmed))
		|| REDEFINE_RTL_MACRO.test(trimmed);
}

export function splitExtraPreamble(extraPreamble: string): ExtraPreambleSplit {
	const removedForTikzJax: string[] = [];
	const kept: string[] = [];

	for (const line of extraPreamble.split('\n')) {
		if (!line.trim()) {
			kept.push(line);
			continue;
		}
		if (isLuaLatexOnlyLine(line)) {
			removedForTikzJax.push(line.trim());
			continue;
		}
		kept.push(line);
	}

	return {
		lualatex: extraPreamble.trim(),
		tikzjax: kept.join('\n').trim(),
		removedForTikzJax,
	};
}
