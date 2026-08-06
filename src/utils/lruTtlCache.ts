/**
 * The in-memory LRU-with-TTL both renderers use for rendered SVG text.
 * Extracted from LuaLatexRenderer and TikzJaxRenderer, which carried the same
 * touch-on-hit / evict-oldest block copy-pasted with the same constants.
 */
export class LruTtlCache<V> {
	private entries = new Map<string, { value: V; createdAt: number }>();

	constructor(
		private readonly maxEntries: number,
		private readonly ttlMs: number,
	) {}

	/** Returns the value and refreshes its LRU position, or null when absent/expired. */
	get(key: string): V | null {
		const entry = this.entries.get(key);
		if (!entry) {
			return null;
		}
		if (Date.now() - entry.createdAt > this.ttlMs) {
			this.entries.delete(key);
			return null;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		}
		this.entries.set(key, { value, createdAt: Date.now() });
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
	}

	clear(): void {
		this.entries.clear();
	}
}
