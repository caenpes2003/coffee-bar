/**
 * Abstract interface for music search providers.
 *
 * Implementing this interface allows swapping between different backends
 * (ytsr, YouTube Data API v3, Spotify, etc.) without changing the rest
 * of the application.
 */
export interface MusicSearchResult {
  youtubeId: string;
  title: string;
  duration: number;
  thumbnail: string | null;
}

export interface MusicSearchProvider {
  /**
   * Provider identifier for logging/debugging.
   */
  readonly name: string;

  /**
   * Search for music tracks.
   * @returns Array of results (empty on failure — never throws).
   */
  search(query: string, limit: number): Promise<MusicSearchResult[]>;
}

/**
 * Injection token for the music search provider.
 */
export const MUSIC_SEARCH_PROVIDER = "MUSIC_SEARCH_PROVIDER";
