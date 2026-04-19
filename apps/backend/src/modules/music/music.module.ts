import { Logger, Module } from "@nestjs/common";
import { MusicController } from "./music.controller";
import { MusicService } from "./music.service";
import { MUSIC_SEARCH_PROVIDER } from "./music-search.provider";
import { YtsrProvider } from "./ytsr.provider";
import { YouTubeDataApiProvider } from "./youtube-data-api.provider";
import { HybridMusicProvider } from "./hybrid.provider";

const logger = new Logger("MusicModule");

/**
 * Provider selection:
 * - YOUTUBE_API_KEY set → Hybrid (cache + YouTube API primary + ytsr fallback)
 * - No API key → ytsr only
 */
@Module({
  controllers: [MusicController],
  providers: [
    MusicService,
    {
      provide: MUSIC_SEARCH_PROVIDER,
      useFactory: () => {
        if (process.env.YOUTUBE_API_KEY) {
          logger.log("Using hybrid provider (YouTube Data API + ytsr + cache)");
          return new HybridMusicProvider(
            new YouTubeDataApiProvider(),
            new YtsrProvider(),
          );
        }
        logger.log("Using ytsr provider (no YOUTUBE_API_KEY set)");
        return new YtsrProvider();
      },
    },
  ],
})
export class MusicModule {}
