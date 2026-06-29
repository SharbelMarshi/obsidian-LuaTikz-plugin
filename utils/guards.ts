export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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
	return /[\u0590-\u05FF\u0600-\u06FF]/.test(text);
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

declare global {
	// eslint-disable-next-line no-var
	var __LUATIKZ_TEX_DIR: string | undefined;
}

/** Absolute path to vendor/tex (core.dump.gz, tex.wasm.gz, tex_files.tar.gz). */
export function setTikzJaxTexDir(texDir: string): void {
	globalThis.__LUATIKZ_TEX_DIR = texDir;
}
