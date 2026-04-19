import { Logger } from "@nestjs/common";
import type { MusicSearchProvider, MusicSearchResult } from "./music-search.provider";
import { SearchCache } from "./search-cache";
import { QuotaBudget } from "./quota-budget";

type ProviderResult =
  | { ok: true; results: MusicSearchResult[] }
  | { ok: false; error: string };

/**
 * Hybrid music search provider.
 *
 * Strategy:
 * 1. Cache first — respond from cache if query was searched recently
 * 2. If quota budget OK → YouTube Data API (primary) → ytsr (fallback)
 * 3. If budget high  → ytsr (primary) → YouTube API (fallback)
 * 4. Both return empty legitimately → [] (cached so we don't retry)
 * 5. Both fail with errors → throw so controller returns 503
 *
 * Config via environment:
 * - YOUTUBE_DAILY_BUDGET_SOFT_LIMIT (default: 8000 units)
 * - SEARCH_CACHE_TTL_SECONDS (default: 1800 = 30 min)
 */
export class HybridMusicProvider implements MusicSearchProvider {
  readonly name = "hybrid";
  private readonly logger = new Logger(HybridMusicProvider.name);
  private readonly cache: SearchCache;
  private readonly budget: QuotaBudget;

  constructor(
    private readonly youtubeApi: MusicSearchProvider,
    private readonly ytsr: MusicSearchProvider,
  ) {
    const cacheTtl = parseInt(process.env.SEARCH_CACHE_TTL_SECONDS ?? "1800", 10);
    const budgetLimit = parseInt(
      process.env.YOUTUBE_DAILY_BUDGET_SOFT_LIMIT ?? "8000",
      10,
    );

    this.cache = new SearchCache(cacheTtl);
    this.budget = new QuotaBudget(budgetLimit);

    this.logger.log(
      `Hybrid provider initialized — cache TTL: ${cacheTtl}s, budget limit: ${budgetLimit} units`,
    );

    // Prune cache every 5 minutes
    setInterval(() => this.cache.prune(), 5 * 60 * 1000);
  }

  async search(query: string, limit: number): Promise<MusicSearchResult[]> {
    // Step 1: Cache
    const cached = this.cache.get(query, limit);
    if (cached) {
      this.logSearch("cache", query, cached.length);
      return cached;
    }

    // Step 2: Decide primary provider based on budget
    const budgetOk = this.budget.canAfford();
    const primary = budgetOk ? this.youtubeApi : this.ytsr;
    const fallback = budgetOk ? this.ytsr : this.youtubeApi;

    // Step 3: Try primary
    const primaryResult = await this.tryProvider(primary, query, limit);

    if (primaryResult.ok && primaryResult.results.length > 0) {
      if (primary === this.youtubeApi) this.budget.consume();
      this.cache.set(query, limit, primaryResult.results);
      this.logSearch(primary.name, query, primaryResult.results.length);
      return primaryResult.results;
    }

    // Primary returned empty or errored — try fallback
    const primaryFailed = !primaryResult.ok;
    if (primaryFailed) {
      this.logger.warn(
        `Primary "${primary.name}" failed: ${primaryResult.error} — trying "${fallback.name}"`,
      );
    }

    // Step 4: Try fallback
    const fallbackResult = await this.tryProvider(fallback, query, limit);

    if (fallbackResult.ok && fallbackResult.results.length > 0) {
      if (fallback === this.youtubeApi) this.budget.consume();
      this.cache.set(query, limit, fallbackResult.results);
      this.logSearch(`${fallback.name} (fallback)`, query, fallbackResult.results.length);
      return fallbackResult.results;
    }

    // Step 5: Both done — distinguish empty vs error
    const bothErrored = primaryFailed && !fallbackResult.ok;

    if (bothErrored) {
      // Both providers failed with technical errors — throw so the
      // controller can return 503 instead of misleading empty results
      this.logger.error(
        `Both providers failed for "${query}" — primary: ${primaryResult.error}, fallback: ${(fallbackResult as { error: string }).error}`,
      );
      throw new Error("SEARCH_UNAVAILABLE");
    }

    // At least one provider responded successfully but with 0 results —
    // this is a legitimate empty result. Cache it to avoid retrying.
    this.cache.set(query, limit, []);
    this.logSearch("empty (legitimate)", query, 0);
    return [];
  }

  private async tryProvider(
    provider: MusicSearchProvider,
    query: string,
    limit: number,
  ): Promise<ProviderResult> {
    try {
      const results = await provider.search(query, limit);
      return { ok: true, results };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Provider "${provider.name}" threw: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  private logSearch(source: string, query: string, count: number): void {
    this.logger.log(
      JSON.stringify({
        event: "hybrid_search",
        source,
        query,
        results_count: count,
        budget_used: this.budget.used,
        budget_remaining: this.budget.remaining,
        cache_size: this.cache.size,
      }),
    );
  }
}
