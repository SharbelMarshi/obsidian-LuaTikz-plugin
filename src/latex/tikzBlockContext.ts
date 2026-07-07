import { COMMAND_LIBRARY_MAP } from './tikzSnippets';

export interface TikzBlockContext {
	source: string;
	environmentStack: string[];
	nodeNames: string[];
	loadedLibraries: string[];
	insideAxis: boolean;
}

const BEGIN_ENV_RE = /\\begin\{([^}]+)\}/g;
const END_ENV_RE = /\\end\{([^}]+)\}/g;
const NODE_NAME_RE = /\\node\s*(?:\[[^\]]*\])?\s*\(([^)]+)\)/g;
const LIBRARY_RE = /\\usetikzlibrary\{([^}]+)\}/g;

export function parseTikzBlockContext(source: string): TikzBlockContext {
	const environmentStack: string[] = [];
	const nodeNames: string[] = [];
	const loadedLibraries: string[] = [];

	for (const match of source.matchAll(BEGIN_ENV_RE)) {
		environmentStack.push(match[1]);
	}
	for (const match of source.matchAll(END_ENV_RE)) {
		const env = match[1];
		const idx = environmentStack.lastIndexOf(env);
		if (idx !== -1) {
			environmentStack.splice(idx, 1);
		}
	}

	for (const match of source.matchAll(NODE_NAME_RE)) {
		const name = match[1].trim();
		if (name && !nodeNames.includes(name)) {
			nodeNames.push(name);
		}
	}

	for (const match of source.matchAll(LIBRARY_RE)) {
		for (const lib of match[1].split(',')) {
			const trimmed = lib.trim();
			if (trimmed && !loadedLibraries.includes(trimmed)) {
				loadedLibraries.push(trimmed);
			}
		}
	}

	const insideAxis = environmentStack.includes('axis')
		|| /\begin\{axis\}/.test(source);

	return {
		source,
		environmentStack,
		nodeNames,
		loadedLibraries,
		insideAxis,
	};
}

export function missingLibrariesForSource(source: string): Map<string, string[]> {
	const ctx = parseTikzBlockContext(source);
	const missing = new Map<string, string[]>();

	for (const [command, libs] of Object.entries(COMMAND_LIBRARY_MAP)) {
		if (!source.includes(command)) {
			continue;
		}
		const absent = libs.filter(lib => !ctx.loadedLibraries.includes(lib));
		if (absent.length > 0) {
			missing.set(command, absent);
		}
	}

	return missing;
}

export function commandsUsedInSource(source: string): string[] {
	const found: string[] = [];
	for (const command of Object.keys(COMMAND_LIBRARY_MAP)) {
		if (source.includes(command)) {
			found.push(command);
		}
	}
	return found;
}

export function findMatchingEnvLine(
	source: string,
	cursorLineInBlock: number,
	isBegin: boolean,
): number | null {
	const lines = source.split('\n');
	const stack: { env: string; line: number }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const match of line.matchAll(BEGIN_ENV_RE)) {
			stack.push({ env: match[1], line: i });
		}
		for (const match of line.matchAll(END_ENV_RE)) {
			const env = match[1];
			const idx = stack.map(entry => entry.env).lastIndexOf(env);
			if (idx !== -1) {
				const begin = stack[idx];
				if (i === cursorLineInBlock || begin.line === cursorLineInBlock) {
					return isBegin ? begin.line : i;
				}
				stack.splice(idx, 1);
			}
		}
	}

	return null;
}

export function allLibrariesNeeded(source: string): string[] {
	const needed = new Set<string>();
	for (const libs of missingLibrariesForSource(source).values()) {
		for (const lib of libs) {
			needed.add(lib);
		}
	}
	return [...needed];
}
