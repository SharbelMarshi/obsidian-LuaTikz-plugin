/**
 * spawnWithTimeout stream handling, against the real src module with a fake
 * child_process.
 *
 * The regression: `stdout += chunk.toString()` decoded each ~64 KB chunk
 * independently, so a multi-byte UTF-8 character split across a chunk
 * boundary became U+FFFD — garbling the Hebrew/Arabic source lines LuaLaTeX
 * echoes into its error output.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

// The module resolves child_process and string_decoder through window.require.
class FakeChild {
	constructor() {
		this.listeners = new Map();
		this.stdout = { on: (event, fn) => this.on(`stdout:${event}`, fn) };
		this.stderr = { on: (event, fn) => this.on(`stderr:${event}`, fn) };
		this.killed = [];
	}
	on(event, fn) { this.listeners.set(event, fn); }
	kill(signal) { this.killed.push(signal); }
	emitStdout(chunk) { this.listeners.get('stdout:data')?.(chunk); }
	close(code) { this.listeners.get('close')?.(code); }
}

const spawned = [];
const { StringDecoder } = await import('node:string_decoder');

globalThis.window = {
	require: (id) => {
		if (id === 'child_process') {
			return { spawn: () => { const child = new FakeChild(); spawned.push(child); return child; } };
		}
		if (id === 'string_decoder') {
			return { StringDecoder };
		}
		throw new Error(`unexpected require: ${id}`);
	},
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (id) => clearTimeout(id),
};

const { shell } = await loadSrcModules({ shell: 'src/desktop/lualatexShell.ts' });

// --- multi-byte character split across chunks -------------------------------

{
	// "שלום" (Hebrew) — split the buffer mid-character.
	const bytes = Buffer.from('error at line: שלום עולם', 'utf8');
	const splitAt = bytes.indexOf(0xd7) + 1; // one byte into the first Hebrew char

	const pending = shell.spawnWithTimeout('lualatex', [], {}, 5000);
	const child = spawned.at(-1);
	child.emitStdout(bytes.subarray(0, splitAt));
	child.emitStdout(bytes.subarray(splitAt));
	child.close(0);

	const { stdout } = await pending;
	assert.equal(stdout, 'error at line: שלום עולם');
	assert.ok(!stdout.includes('�'), `replacement characters in output: ${JSON.stringify(stdout)}`);
}

// --- failure path carries decoded output ------------------------------------

{
	const bytes = Buffer.from('! Undefined control sequence. l.5 \\שגיאה', 'utf8');
	const splitAt = bytes.lastIndexOf(0xd7) + 1;

	const pending = shell.spawnWithTimeout('lualatex', [], {}, 5000);
	const child = spawned.at(-1);
	child.emitStdout(bytes.subarray(0, splitAt));
	child.emitStdout(bytes.subarray(splitAt));
	child.close(1);

	await assert.rejects(pending, (err) => {
		assert.ok(err.stdout.includes('\\שגיאה'), `stdout garbled: ${JSON.stringify(err.stdout)}`);
		assert.ok(!err.stdout.includes('�'));
		return true;
	});
}

// --- buffer cap still applies -----------------------------------------------

{
	const pending = shell.spawnWithTimeout('lualatex', [], { maxBuffer: 100 }, 5000);
	const child = spawned.at(-1);
	for (let i = 0; i < 50; i++) {
		child.emitStdout(Buffer.from(`chunk-${String(i).padStart(3, '0')} `, 'utf8'));
	}
	child.close(0);

	const { stdout } = await pending;
	assert.ok(stdout.length <= 100, `buffer cap not applied: ${stdout.length}`);
	assert.ok(stdout.endsWith('chunk-049 '), 'cap must keep the tail, not the head');
}

// --- kill switch -------------------------------------------------------------

{
	const pending = shell.spawnWithTimeout('lualatex', [], {}, 5000);
	const child = spawned.at(-1);
	shell.killAllRunningCompiles();
	assert.deepEqual(child.killed, ['SIGKILL'], 'killAllRunningCompiles must SIGKILL in-flight children');
	child.close(null);
	await assert.rejects(pending);
}

console.log('test-spawn-decoding: ok');
