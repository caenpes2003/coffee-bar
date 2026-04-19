import type { MusicSearchResult } from "./music-search.provider";

interface CacheEntry {
  results: MusicSearchResult[];
  cachedAt: number;
}

/**
 * In-memory cache for music search results.
 * Keyed by normalized query string, with configurable TTL.
 *
 * LIMITATION: This is per-process. If the backend scales to multiple
 * instances, each will have its own cache. Migrate to Redis or a shared
 * store when horizontal scaling is needed.
 */
export class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, " ");
  }

  get(query: string, limit: number): MusicSearchResult[] | null {
    const key = `${this.normalizeQuery(query)}:${limit}`;
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  set(query: string, limit: number, results: MusicSearchResult[]): void {
    const key = `${this.normalizeQuery(query)}:${limit}`;
    this.cache.set(key, { results, cachedAt: Date.now() });
  }

  get size(): number {
    return this.cache.size;
  }

  /** Remove expired entries */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
