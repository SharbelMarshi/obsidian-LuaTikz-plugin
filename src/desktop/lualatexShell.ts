import { validateLualatexPath } from '../utils/guards';

/** Electron runtime require (desktop Obsidian only). */
interface NodeRequire {
	(id: string): unknown;
}

interface ChildProcess {
	stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
	stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
	on(event: 'error', listener: (err: Error) => void): void;
	on(event: 'close', listener: (code: number | null) => void): void;
	kill(signal: string): void;
}

interface ChildProcessModule {
	spawn(file: string, args: string[], options: { cwd?: string; shell?: boolean; windowsHide?: boolean }): ChildProcess;
}

// Desktop-only: child_process is used solely to run the user-configured
// LuaLaTeX binary and pdftocairo with shell:false (no shell interpretation),
// and fs only to read compile artifacts under the vault's plugin folder.
// Both are resolved through Electron's require and are unavailable on mobile.
const CHILD_PROCESS_MODULE = 'child_process';
const FS_MODULE = 'fs';

interface DesktopFs {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: 'utf8'): string;
	readFileSync(path: string): Buffer;
}

function tryLoadFs(): DesktopFs | null {
	const req = electronRequire();
	if (!req) {
		return null;
	}
	try {
		return req(FS_MODULE) as DesktopFs;
	} catch {
		return null;
	}
}

export function desktopFsExists(fsPath: string): boolean {
	const fs = tryLoadFs();
	return fs?.existsSync(fsPath) ?? false;
}

export function desktopFsReadText(fsPath: string, maxChars = 8000): string {
	const fs = tryLoadFs();
	if (!fs?.existsSync(fsPath)) {
		return '';
	}
	const text = fs.readFileSync(fsPath, 'utf8');
	return text.length <= maxChars ? text : `...(truncated)...\n${text.slice(-maxChars)}`;
}

export function desktopFsReadBinary(fsPath: string): Uint8Array | null {
	const fs = tryLoadFs();
	if (!fs?.existsSync(fsPath)) {
		return null;
	}
	const data = fs.readFileSync(fsPath);
	return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function electronRequire(): NodeRequire | null {
	const win = window as Window & { require?: NodeRequire };
	const req = win.require;
	return typeof req === 'function' ? req : null;
}

function loadChildProcess(): ChildProcessModule {
	const req = electronRequire();
	if (!req) {
		throw new Error('Local LuaLaTeX requires desktop Obsidian');
	}
	return req(CHILD_PROCESS_MODULE) as ChildProcessModule;
}

export class RenderTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
		this.name = 'RenderTimeoutError';
	}
}

export interface SpawnResult {
	stdout: string;
	stderr: string;
}

interface StringDecoderLike {
	write(chunk: Buffer | string): string;
	end(): string;
}

interface StringDecoderModule {
	StringDecoder: new (encoding: string) => StringDecoderLike;
}

function tryLoadStringDecoder(): StringDecoderLike | null {
	const req = electronRequire();
	if (!req) {
		return null;
	}
	try {
		const mod = req('string_decoder') as StringDecoderModule;
		return new mod.StringDecoder('utf8');
	} catch {
		return null;
	}
}

/**
 * Accumulates decoded chunks in an array (joined once at the end) and decodes
 * through a StringDecoder. Naive `stdout += chunk.toString()` had two flaws:
 * a multi-byte UTF-8 character split across ~64 KB chunk boundaries became
 * U+FFFD — garbling the Hebrew/Arabic source lines LuaLaTeX echoes into its
 * error output — and re-slicing the whole string per chunk was O(n²) once the
 * buffer cap was reached.
 */
class ChunkCollector {
	private parts: string[] = [];
	private length = 0;
	private readonly decoder = tryLoadStringDecoder();

	constructor(private readonly maxBuffer: number) {}

	push(chunk: Buffer | string): void {
		const text = typeof chunk === 'string'
			? chunk
			: this.decoder?.write(chunk) ?? chunk.toString();
		this.parts.push(text);
		this.length += text.length;

		if (this.length > this.maxBuffer && this.parts.length > 1) {
			// Drop whole leading parts; exact tail trimming happens in read().
			while (this.parts.length > 1 && this.length - this.parts[0].length > this.maxBuffer) {
				this.length -= this.parts[0].length;
				this.parts.shift();
			}
		}
	}

	read(): string {
		const tail = this.decoder?.end() ?? '';
		const joined = this.parts.join('') + tail;
		return joined.length > this.maxBuffer ? joined.slice(-this.maxBuffer) : joined;
	}
}

/**
 * Children of in-flight compiles. spawnWithTimeout used to register its child
 * nowhere, so disabling the plugin mid-compile orphaned the lualatex process
 * and its job directory in the vault.
 */
const runningChildren = new Set<ChildProcess>();

export function killAllRunningCompiles(): void {
	for (const child of runningChildren) {
		try {
			child.kill('SIGKILL');
		} catch {
			// already exited
		}
	}
	runningChildren.clear();
}

export function spawnWithTimeout(
	file: string,
	args: string[],
	options: { cwd?: string; maxBuffer?: number },
	timeoutMs: number,
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		let timedOut = false;
		const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
		const stdout = new ChunkCollector(maxBuffer);
		const stderr = new ChunkCollector(maxBuffer);
		const childProcess = loadChildProcess();

		const child = childProcess.spawn(file, args, {
			cwd: options.cwd,
			shell: false,
			windowsHide: true,
		});
		runningChildren.add(child);

		child.stdout?.on('data', (chunk: Buffer | string) => {
			stdout.push(chunk);
		});

		child.stderr?.on('data', (chunk: Buffer | string) => {
			stderr.push(chunk);
		});

		const timer = window.setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
			reject(new RenderTimeoutError(timeoutMs));
		}, timeoutMs);

		child.on('error', (err) => {
			window.clearTimeout(timer);
			runningChildren.delete(child);
			if (!timedOut) {
				reject(err);
			}
		});

		child.on('close', (code) => {
			window.clearTimeout(timer);
			runningChildren.delete(child);
			if (timedOut) {
				return;
			}
			if (code !== 0) {
				const err = new Error(`Process exited with code ${code ?? 'unknown'}`);
				(err as Error & { stdout?: string; stderr?: string }).stdout = stdout.read();
				(err as Error & { stdout?: string; stderr?: string }).stderr = stderr.read();
				reject(err);
				return;
			}
			resolve({ stdout: stdout.read(), stderr: stderr.read() });
		});
	});
}

async function commandIsRunnable(command: string, probeArgs: readonly string[] = ['--version']): Promise<boolean> {
	try {
		await spawnWithTimeout(command, [...probeArgs], {}, 5_000);
		return true;
	} catch {
		return false;
	}
}

async function resolveCommand(
	candidates: readonly string[],
	probeArgs: readonly string[] = ['--version'],
): Promise<string | null> {
	for (const candidate of candidates) {
		if (candidate.includes('/') || candidate.includes('\\')) {
			if (await commandIsRunnable(candidate, probeArgs)) {
				return candidate;
			}
			continue;
		}

		try {
			const { stdout } = await spawnWithTimeout('/usr/bin/which', [candidate], {}, 5_000);
			const resolved = stdout.trim();
			if (resolved && await commandIsRunnable(resolved, probeArgs)) {
				return resolved;
			}
			continue;
		} catch {
			// which unavailable (e.g. Windows) — fall through to a direct probe
		}

		try {
			// spawn() searches PATH on every platform, so probe the bare name too.
			if (await commandIsRunnable(candidate, probeArgs)) {
				return candidate;
			}
		} catch {
			// try next candidate
		}
	}
	return null;
}

/**
 * Successful resolutions, keyed by the custom path in force. Unmemoized,
 * every render re-probed the binaries — 2-6 extra process spawns (each with a
 * 5 s timeout budget) per diagram. Failures are deliberately NOT cached: a
 * user who installs TeX mid-session recovers on the next render.
 */
const resolvedCommands = new Map<string, string>();

export function clearCommandResolutionCache(): void {
	resolvedCommands.clear();
}

export async function resolveLuaLatex(customPath?: string): Promise<string | null> {
	const memoKey = `lualatex:${customPath?.trim() ?? ''}`;
	const memoized = resolvedCommands.get(memoKey);
	if (memoized !== undefined) {
		return memoized;
	}

	const resolve = async (): Promise<string | null> => {
		if (customPath?.trim()) {
			const validationError = validateLualatexPath(customPath);
			if (validationError) {
				return null;
			}
			if (await commandIsRunnable(customPath.trim())) {
				return customPath.trim();
			}
		}

		return resolveCommand([
			'/Library/TeX/texbin/lualatex',
			'/usr/local/texlive/2025/bin/universal-darwin/lualatex',
			'/usr/local/bin/lualatex',
			'lualatex',
		]);
	};

	const resolved = await resolve();
	if (resolved) {
		resolvedCommands.set(memoKey, resolved);
	}
	return resolved;
}

export async function resolvePdfToCairo(): Promise<string | null> {
	const memoized = resolvedCommands.get('pdftocairo');
	if (memoized !== undefined) {
		return memoized;
	}

	// pdftocairo rejects --version; it requires -v or an output-format flag.
	const resolved = await resolveCommand([
		'/opt/homebrew/bin/pdftocairo',
		'/usr/local/bin/pdftocairo',
		'/usr/bin/pdftocairo',
		'pdftocairo',
	], ['-v']);
	if (resolved) {
		resolvedCommands.set('pdftocairo', resolved);
	}
	return resolved;
}

export function formatExecError(err: unknown): string {
	if (err instanceof RenderTimeoutError) {
		return err.message;
	}
	if (err instanceof Error) {
		const execErr = err as Error & { stdout?: string; stderr?: string };
		return [execErr.message, execErr.stdout, execErr.stderr].filter(Boolean).join('\n');
	}
	return String(err);
}
