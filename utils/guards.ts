export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
	return typeof value === 'function';
}

export function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function containsRtlText(text: string): boolean {
	const hebrew = /[\u0590-\u05FF]/;
	const arabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
	return hebrew.test(text) || arabic.test(text);
}

export function getStringProperty(
	value: unknown,
	key: string,
): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const property = value[key];
	return typeof property === 'string' ? property : undefined;
}

export function getNumberProperty(
	value: unknown,
	key: string,
): number | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const property = value[key];
	return typeof property === 'number' ? property : undefined;
}

export function getBooleanProperty(
	value: unknown,
	key: string,
): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const property = value[key];
	return typeof property === 'boolean' ? property : undefined;
}

export function firstMapKey<K extends string, V>(map: Map<K, V>): K | undefined {
	const next = map.keys().next();
	if (next.done) {
		return undefined;
	}

	const key: unknown = next.value;
	return typeof key === 'string' ? (key as K) : undefined;
}

const SHELL_METACHAR_RE = /[;&|`$(){}[\]<>'"\\!\n\r\0]/;

export function validateLualatexPath(pathValue: string): string | null {
	const trimmed = pathValue.trim();
	if (!trimmed) {
		return 'LuaLaTeX path must not be empty.';
	}
	if (trimmed.includes('\0')) {
		return 'LuaLaTeX path contains invalid characters.';
	}
	if (SHELL_METACHAR_RE.test(trimmed)) {
		return 'LuaLaTeX path must be a direct executable path without shell metacharacters.';
	}
	return null;
}

export function sanitizeCacheFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}
