import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  MUSIC_SEARCH_PROVIDER,
  type MusicSearchProvider,
  type MusicSearchResult,
} from "./music-search.provider";
import { HybridMusicProvider } from "./hybrid.provider";

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  constructor(
    @Inject(MUSIC_SEARCH_PROVIDER)
    private readonly provider: MusicSearchProvider,
  ) {
    this.logger.log(`Music search provider: ${this.provider.name}`);
  }

  /**
   * Per-key quota snapshot for the admin status widget. Returns null when
   * the active provider doesn't track budgets (e.g. ytsr-only deploys
   * with no API key configured). The numbers are best-effort: they live
   * in the process memory and reset on backend restart, so they show
   * "since last deploy" rather than absolute daily totals. For the
   * authoritative count, the admin must look at console.cloud.google.com.
   */
  getBudgetSnapshot() {
    if (this.provider instanceof HybridMusicProvider) {
      return this.provider.getBudgetSnapshot();
    }
    return null;
  }

  async search(query: string, limit = 5): Promise<MusicSearchResult[]> {
    const start = Date.now();

    try {
      const results = await this.provider.search(query, limit);
      const elapsed = Date.now() - start;

      this.logger.log(
        JSON.stringify({
          event: "music_search",
          status: "success",
          provider: this.provider.name,
          query,
          limit,
          results_count: results.length,
          duration_ms: elapsed,
        }),
      );

      return results;
    } catch (error) {
      const elapsed = Date.now() - start;
      const errorCode =
        error instanceof Error && "code" in error
          ? (error as { code: string }).code
          : undefined;

      this.logger.error(
        JSON.stringify({
          event: "music_search",
          status: "error",
          provider: this.provider.name,
          query,
          limit,
          duration_ms: elapsed,
          error: error instanceof Error ? error.message : String(error),
          error_code: errorCode ?? null,
        }),
      );

      throw error;
    }
  }
}
