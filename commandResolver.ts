import { spawn } from 'child_process';
import * as fs from 'fs';
import { validateLualatexPath } from './utils/guards';

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

		const child = spawn(file, args, {
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

async function resolveCommand(candidates: string[]): Promise<string | null> {
	for (const candidate of candidates) {
		if (candidate.includes('/')) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
			continue;
		}

		try {
			const { stdout } = await spawnWithTimeout('/usr/bin/which', [candidate], {}, 5_000);
			const resolved = stdout.trim();
			if (resolved) {
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
		if (fs.existsSync(customPath.trim())) {
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
	return resolveCommand([
		'/opt/homebrew/bin/pdftocairo',
		'/usr/local/bin/pdftocairo',
		'/usr/bin/pdftocairo',
		'pdftocairo',
	]);
}

export function readLogTail(logPath: string, maxChars = 8000): string {
	if (!fs.existsSync(logPath)) {
		return '';
	}
	const log = fs.readFileSync(logPath, 'utf8');
	return log.length <= maxChars ? log : `...(truncated)...\n${log.slice(-maxChars)}`;
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

/** @deprecated Use spawnWithTimeout */
export const execFileWithTimeout = spawnWithTimeout;
