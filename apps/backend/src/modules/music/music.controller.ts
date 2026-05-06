import {
  Controller,
  Get,
  Query,
  BadRequestException,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { MusicService } from "./music.service";
import { YouTubeApiError } from "./youtube-data-api.provider";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";

@Controller("music")
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  /**
   * Admin-only quota status for the dashboard widget. Returns null inside
   * the response when the deploy is on a no-key (ytsr-only) configuration
   * — the UI can render that as "no quota tracking" instead of crashing.
   */
  @Get("budget")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  budget() {
    return { snapshot: this.musicService.getBudgetSnapshot() };
  }

  @Get("search")
  async search(@Query("q") query: string) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException({
        message: "Query parameter 'q' is required",
        code: "SEARCH_QUERY_REQUIRED",
      });
    }

    if (query.trim().length < 2) {
      throw new BadRequestException({
        message: "Query must be at least 2 characters",
        code: "SEARCH_QUERY_TOO_SHORT",
      });
    }

    try {
      return await this.musicService.search(query.trim());
    } catch (error) {
      if (error instanceof YouTubeApiError) {
        if (error.code === "QUOTA_EXCEEDED") {
          throw new ServiceUnavailableException({
            message: "El servicio de búsqueda ha alcanzado su límite diario",
            code: "SEARCH_QUOTA_EXCEEDED",
          });
        }
        throw new ServiceUnavailableException({
          message: "El servicio de búsqueda no está disponible temporalmente",
          code: "SEARCH_UPSTREAM_ERROR",
        });
      }

      // Hybrid provider throws "SEARCH_UNAVAILABLE" when all providers fail
      if (
        error instanceof Error &&
        error.message === "SEARCH_UNAVAILABLE"
      ) {
        throw new ServiceUnavailableException({
          message: "El servicio de búsqueda no está disponible en este momento",
          code: "SEARCH_UNAVAILABLE",
        });
      }

      throw error;
    }
  }
}
