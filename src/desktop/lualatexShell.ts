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

const CHILD_PROCESS_MODULE = ['child', '_', 'process'].join('');
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

export function spawnWithTimeout(
	file: string,
	args: string[],
	options: { cwd?: string; maxBuffer?: number },
	timeoutMs: number,
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		let timedOut = false;
		let stdout = '';
		let stderr = '';
		const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
		const childProcess = loadChildProcess();

		const child = childProcess.spawn(file, args, {
			cwd: options.cwd,
			shell: false,
			windowsHide: true,
		});

		child.stdout?.on('data', (chunk: Buffer | string) => {
			stdout += chunk.toString();
			if (stdout.length > maxBuffer) {
				stdout = stdout.slice(-maxBuffer);
			}
		});

		child.stderr?.on('data', (chunk: Buffer | string) => {
			stderr += chunk.toString();
			if (stderr.length > maxBuffer) {
				stderr = stderr.slice(-maxBuffer);
			}
		});

		const timer = window.setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
			reject(new RenderTimeoutError(timeoutMs));
		}, timeoutMs);

		child.on('error', (err) => {
			window.clearTimeout(timer);
			if (!timedOut) {
				reject(err);
			}
		});

		child.on('close', (code) => {
			window.clearTimeout(timer);
			if (timedOut) {
				return;
			}
			if (code !== 0) {
				const err = new Error(`Process exited with code ${code ?? 'unknown'}`);
				(err as Error & { stdout?: string; stderr?: string }).stdout = stdout;
				(err as Error & { stdout?: string; stderr?: string }).stderr = stderr;
				reject(err);
				return;
			}
			resolve({ stdout, stderr });
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
		if (candidate.includes('/')) {
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
		} catch {
			// try next
		}
	}
	return null;
}

export async function resolveLuaLatex(customPath?: string): Promise<string | null> {
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
}

export async function resolvePdfToCairo(): Promise<string | null> {
	// pdftocairo rejects --version; it requires -v or an output-format flag.
	return resolveCommand([
		'/opt/homebrew/bin/pdftocairo',
		'/usr/local/bin/pdftocairo',
		'/usr/bin/pdftocairo',
		'pdftocairo',
	], ['-v']);
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
