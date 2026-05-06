import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface YouTubeVideoMeta {
  youtube_id: string;
  title: string;
  artist: string | null;
  duration: number;
  thumbnail: string | null;
}

@Injectable()
export class HousePlaylistService {
  private readonly logger = new Logger(HousePlaylistService.name);
  /**
   * Ordered list of YouTube API keys, same convention as MusicModule:
   *   YOUTUBE_API_KEY      — primary
   *   YOUTUBE_API_KEY_2..N — fallbacks, used when an earlier key 403s
   *
   * We don't keep a per-key budget here because validations are very
   * cheap (1 unit per call) and rare (admin-side only). When a key
   * returns 403 we just walk to the next one.
   */
  private readonly apiKeys: string[] = [
    process.env.YOUTUBE_API_KEY ?? "",
    process.env.YOUTUBE_API_KEY_2 ?? "",
    process.env.YOUTUBE_API_KEY_3 ?? "",
  ].filter((k) => k.length > 0);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  findAll() {
    return this.prisma.housePlaylistItem.findMany({
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
      include: {
        categories: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.housePlaylistItem.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundException({
        message: `HousePlaylistItem ${id} not found`,
        code: "HOUSE_PLAYLIST_NOT_FOUND",
      });
    }
    return item;
  }

  async create(input: {
    youtube_id: string;
    title: string;
    artist?: string | null;
    duration: number;
  }) {
    if (!input.youtube_id || input.youtube_id.length !== 11) {
      throw new BadRequestException({
        message: "Invalid youtube_id (expected 11 characters)",
        code: "HOUSE_PLAYLIST_INVALID_ID",
      });
    }
    try {
      // Order new items at the bottom of the active set so the rotation
      // doesn't bump existing ones around.
      const last = await this.prisma.housePlaylistItem.findFirst({
        orderBy: { sort_order: "desc" },
        select: { sort_order: true },
      });
      return await this.prisma.housePlaylistItem.create({
        data: {
          youtube_id: input.youtube_id,
          title: input.title,
          artist: input.artist ?? null,
          duration: input.duration,
          sort_order: (last?.sort_order ?? 0) + 1,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new BadRequestException({
          message: "Esa canción ya está en la playlist base",
          code: "HOUSE_PLAYLIST_DUPLICATE",
        });
      }
      throw e;
    }
  }

  async update(
    id: number,
    patch: Partial<{ is_active: boolean; sort_order: number; title: string }>,
  ) {
    await this.findOne(id);
    return this.prisma.housePlaylistItem.update({
      where: { id },
      data: patch,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.housePlaylistItem.delete({ where: { id } });
    return { ok: true };
  }

  // ─── YouTube validation ───────────────────────────────────────────────────

  /**
   * Best-effort URL → youtube_id extractor. Accepts:
   *   - youtube.com/watch?v=ID
   *   - youtu.be/ID
   *   - youtube.com/embed/ID
   *   - youtube.com/shorts/ID  (rejected later by validate; shorts <60s)
   *   - bare 11-char ID
   *
   * Returns null when no plausible id is found.
   */
  static extractYoutubeId(input: string): string | null {
    const trimmed = (input ?? "").trim();
    if (!trimmed) return null;

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Hits /videos?id=X on the YouTube Data API to confirm the id exists,
   * is embeddable, and pulls the canonical title + duration.
   */
  async validateYoutubeId(youtubeId: string): Promise<YouTubeVideoMeta> {
    if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      throw new BadRequestException({
        message: "URL o ID de YouTube no válido",
        code: "HOUSE_PLAYLIST_INVALID_URL",
      });
    }
    if (this.apiKeys.length === 0) {
      throw new ServiceUnavailableException({
        message: "Validación de YouTube no disponible (API key no configurada)",
        code: "HOUSE_PLAYLIST_API_DISABLED",
      });
    }

    // Try each configured API key in order. A 403 on key #1 (quota
    // exhausted, daily reset, billing issue) walks to key #2, then #3.
    // Anything that's NOT a 403 is reported up — those are usually real
    // problems with the video itself, not the key.
    let lastQuotaError = false;
    let lastNetworkError: string | null = null;

    type YouTubeVideosResponse = {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          channelTitle?: string;
          thumbnails?: {
            default?: { url?: string };
            medium?: { url?: string };
          };
        };
        contentDetails?: { duration?: string };
        status?: { embeddable?: boolean; uploadStatus?: string };
      }>;
    };

    let data: YouTubeVideosResponse | null = null;

    for (let i = 0; i < this.apiKeys.length; i++) {
      const key = this.apiKeys[i];
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("id", youtubeId);
      url.searchParams.set("key", key);

      let res: Response;
      try {
        res = await fetch(url.toString());
      } catch (err) {
        lastNetworkError = String(err);
        this.logger.warn(
          `fetch YouTube /videos failed on key #${i + 1}: ${lastNetworkError} — trying next key`,
        );
        continue;
      }

      if (res.ok) {
        data = (await res.json()) as YouTubeVideosResponse;
        break;
      }

      const body = await res.text().catch(() => "");
      this.logger.warn(
        `YouTube /videos returned ${res.status} on key #${i + 1}: ${body.slice(0, 200)}`,
      );
      if (res.status === 403) {
        lastQuotaError = true;
        continue; // try the next key
      }
      // Non-quota error (404, 400, 5xx) — abort, it's about this video.
      throw new ServiceUnavailableException({
        message: "YouTube respondió con un error",
        code: "HOUSE_PLAYLIST_UPSTREAM_ERROR",
      });
    }

    if (!data) {
      // Every key was exhausted or every fetch failed at the network
      // layer. Distinguish so the admin sees a useful message.
      if (lastQuotaError) {
        throw new ServiceUnavailableException({
          message: "Cuota de YouTube agotada en todas las keys configuradas",
          code: "HOUSE_PLAYLIST_QUOTA_EXCEEDED",
        });
      }
      this.logger.error(
        `All YouTube validation attempts failed — last network error: ${lastNetworkError}`,
      );
      throw new ServiceUnavailableException({
        message: "No se pudo validar la canción con YouTube",
        code: "HOUSE_PLAYLIST_UPSTREAM_ERROR",
      });
    }

    const item = data.items?.[0];
    if (!item) {
      throw new BadRequestException({
        message: "No encontramos esta canción en YouTube",
        code: "HOUSE_PLAYLIST_NOT_FOUND_REMOTE",
      });
    }
    if (item.status?.embeddable === false) {
      throw new BadRequestException({
        message: "Este video no permite incrustarse — usa otro",
        code: "HOUSE_PLAYLIST_NOT_EMBEDDABLE",
      });
    }
    const duration = parseIsoDuration(item.contentDetails?.duration ?? "");
    if (duration <= 0) {
      throw new BadRequestException({
        message: "No se pudo leer la duración del video",
        code: "HOUSE_PLAYLIST_NO_DURATION",
      });
    }

    return {
      youtube_id: item.id,
      title: item.snippet?.title ?? "Sin título",
      artist: item.snippet?.channelTitle ?? null,
      duration,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        null,
    };
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  listCategories() {
    return this.prisma.housePlaylistCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
  }

  async createCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException({
        message: "El nombre de la categoría no puede estar vacío",
        code: "HOUSE_PLAYLIST_CATEGORY_INVALID_NAME",
      });
    }
    try {
      return await this.prisma.housePlaylistCategory.create({
        data: { name: trimmed },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new BadRequestException({
          message: "Ya existe una categoría con ese nombre",
          code: "HOUSE_PLAYLIST_CATEGORY_DUPLICATE",
        });
      }
      throw e;
    }
  }

  async renameCategory(id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException({
        message: "El nombre de la categoría no puede estar vacío",
        code: "HOUSE_PLAYLIST_CATEGORY_INVALID_NAME",
      });
    }
    try {
      return await this.prisma.housePlaylistCategory.update({
        where: { id },
        data: { name: trimmed },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new BadRequestException({
          message: "Ya existe una categoría con ese nombre",
          code: "HOUSE_PLAYLIST_CATEGORY_DUPLICATE",
        });
      }
      throw e;
    }
  }

  async deleteCategory(id: number) {
    // If we're deleting the active category, clear the active setting
    // first so the fallback logic doesn't keep trying to load songs from
    // a phantom id.
    const active = await this.getActiveCategoryId();
    if (active === id) {
      await this.setActiveCategoryId(null);
    }
    await this.prisma.housePlaylistCategory.delete({ where: { id } });
    return { ok: true };
  }

  async setItemCategories(itemId: number, categoryIds: number[]) {
    await this.findOne(itemId);
    return this.prisma.housePlaylistItem.update({
      where: { id: itemId },
      data: {
        categories: {
          set: categoryIds.map((id) => ({ id })),
        },
      },
      include: { categories: true },
    });
  }

  // ─── Active category (Setting bag) ────────────────────────────────────────

  private static readonly ACTIVE_KEY = "house_playlist_active_category_id";

  async getActiveCategoryId(): Promise<number | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: HousePlaylistService.ACTIVE_KEY },
    });
    if (!row) return null;
    const v = row.value as unknown;
    if (typeof v === "number") return v;
    if (v == null) return null;
    return null;
  }

  async setActiveCategoryId(categoryId: number | null) {
    if (categoryId != null) {
      // Reject empty categories — the runtime fallback would otherwise
      // crash into silence the moment the queue empties.
      const count = await this.prisma.housePlaylistItem.count({
        where: {
          is_active: true,
          categories: { some: { id: categoryId } },
        },
      });
      if (count === 0) {
        throw new BadRequestException({
          message:
            "Esa categoría no tiene canciones activas. Agrega al menos una antes de activarla.",
          code: "HOUSE_PLAYLIST_CATEGORY_EMPTY",
        });
      }
    }
    await this.prisma.setting.upsert({
      where: { key: HousePlaylistService.ACTIVE_KEY },
      update: {
        value: (categoryId ?? null) as Prisma.InputJsonValue,
      },
      create: {
        key: HousePlaylistService.ACTIVE_KEY,
        value: (categoryId ?? null) as Prisma.InputJsonValue,
      },
    });
    return { active_category_id: categoryId };
  }

  // ─── Fallback selection ───────────────────────────────────────────────────

  /**
   * Picks the next house song when the customer queue is empty. The
   * strategy is "shuffle with cooldown": pick uniformly at random from
   * the active category's pool, but exclude the last 10 songs we played
   * so the same track doesn't surface back-to-back. If the cooldown
   * window leaves the pool empty (e.g. category has only 5 songs), we
   * relax it and pick from the full pool — better a near-repeat than
   * silence.
   *
   * Returns null when no active category is selected, the active
   * category was deleted, or no items are active.
   */
  async pickNextHouseSong() {
    const activeCategoryId = await this.getActiveCategoryId();
    const baseWhere: Prisma.HousePlaylistItemWhereInput = activeCategoryId
      ? {
          is_active: true,
          categories: { some: { id: activeCategoryId } },
        }
      : { is_active: true };

    const COOLDOWN = 10;
    const recents = await this.prisma.housePlaylistItem.findMany({
      where: { ...baseWhere, last_played_at: { not: null } },
      orderBy: { last_played_at: "desc" },
      take: COOLDOWN,
      select: { id: true },
    });
    const cooldownIds = recents.map((r) => r.id);

    let pool = await this.prisma.housePlaylistItem.findMany({
      where: {
        ...baseWhere,
        id: cooldownIds.length > 0 ? { notIn: cooldownIds } : undefined,
      },
      select: { id: true },
    });
    // Cooldown bigger than the pool → relax. The bar still gets music
    // instead of silence; the same song just may repeat sooner.
    if (pool.length === 0) {
      pool = await this.prisma.housePlaylistItem.findMany({
        where: baseWhere,
        select: { id: true },
      });
    }
    if (pool.length === 0) return null;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    return this.prisma.housePlaylistItem.findUnique({
      where: { id: pick.id },
    });
  }

  async stampPlayed(houseItemId: number) {
    await this.prisma.housePlaylistItem.update({
      where: { id: houseItemId },
      data: { last_played_at: new Date() },
    });
  }
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}
