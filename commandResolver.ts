import { execFile, type ExecFileOptions } from 'child_process';
import * as fs from 'fs';

export class RenderTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
		this.name = 'RenderTimeoutError';
	}
}

export function execFileWithTimeout(
	file: string,
	args: string[],
	options: ExecFileOptions,
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		let timedOut = false;

		const child = execFile(file, args, options, (err, stdout, stderr) => {
			if (timedOut) {
				return;
			}
			window.clearTimeout(timer);
			if (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
				return;
			}
			resolve({
				stdout: stdout?.toString() ?? '',
				stderr: stderr?.toString() ?? '',
			});
		});

		const timer = window.setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
			reject(new RenderTimeoutError(timeoutMs));
		}, timeoutMs);
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
			const { stdout } = await execFileWithTimeout('/usr/bin/which', [candidate], {}, 5_000);
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

export async function resolveLuaLatex(): Promise<string | null> {
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
