import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QueueStatus, TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import {
  MAX_SONG_DURATION_SECONDS,
  MAX_SONGS_PER_TABLE,
  EXTRA_SONG_CONSUMPTION_THRESHOLD,
  QUEUE_LIMIT_COOLDOWN_MINUTES,
} from "@coffee-bar/shared";
import { PlaybackService } from "../playback/playback.service";
import { FairnessService } from "./fairness.service";

const queueInclude = {
  song: true,
  table: true,
} satisfies Prisma.QueueItemInclude;

type QueueRecord = Prisma.QueueItemGetPayload<{ include: typeof queueInclude }>;

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly playbackService: PlaybackService,
    private readonly fairnessService: FairnessService,
  ) {}

  async findGlobal() {
    const items = await this.prisma.queueItem.findMany({
      where: {
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
      },
      include: queueInclude,
      orderBy: [{ position: "asc" }],
    });

    return items.map((item) => this.serializeQueueItem(item));
  }

  async findByTable(tableId: number, includeHistory = false) {
    if (!includeHistory) {
      const items = await this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.pending, QueueStatus.playing] },
        },
        include: queueInclude,
        orderBy: [{ position: "asc" }],
      });
      return items.map((item) => this.serializeQueueItem(item));
    }

    // Include active + recent history (played/skipped, last 10)
    const [active, history] = await Promise.all([
      this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.pending, QueueStatus.playing] },
        },
        include: queueInclude,
        orderBy: [{ position: "asc" }],
      }),
      this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.played, QueueStatus.skipped] },
        },
        include: queueInclude,
        orderBy: [{ updated_at: "desc" }],
        take: 10,
      }),
    ]);

    return [...active, ...history].map((item) => this.serializeQueueItem(item));
  }

  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [played, skipped, pending, totalSongs] = await Promise.all([
      this.prisma.queueItem.count({
        where: { status: QueueStatus.played, updated_at: { gte: todayStart } },
      }),
      this.prisma.queueItem.count({
        where: { status: QueueStatus.skipped, updated_at: { gte: todayStart } },
      }),
      this.prisma.queueItem.count({
        where: { status: QueueStatus.pending },
      }),
      this.prisma.queueItem.count({
        where: { updated_at: { gte: todayStart } },
      }),
    ]);

    // Top table by songs played today
    const topTable = await this.prisma.queueItem.groupBy({
      by: ["table_id"],
      where: { status: QueueStatus.played, updated_at: { gte: todayStart } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    });

    // Average wait time (queued_at → started_playing_at) for today's played songs
    const playedWithTimes = await this.prisma.queueItem.findMany({
      where: {
        status: QueueStatus.played,
        updated_at: { gte: todayStart },
        started_playing_at: { not: null },
      },
      select: { queued_at: true, started_playing_at: true },
      take: 50, // Limit to avoid outlier skew
      orderBy: { updated_at: "desc" },
    });

    let avg_wait_seconds: number | null = null;
    if (playedWithTimes.length > 0) {
      const totalWait = playedWithTimes.reduce((sum, item) => {
        const wait =
          (item.started_playing_at!.getTime() - item.queued_at.getTime()) / 1000;
        return sum + Math.max(0, wait);
      }, 0);
      avg_wait_seconds = Math.round(totalWait / playedWithTimes.length);
    }

    // Tables participating today (only played/skipped, not just pending)
    const tablesParticipating = await this.prisma.queueItem.findMany({
      where: {
        updated_at: { gte: todayStart },
        status: { in: [QueueStatus.played, QueueStatus.skipped] },
      },
      select: { table_id: true },
      distinct: ["table_id"],
    });

    // Average playback duration (started_playing_at → finished_at|skipped_at)
    const withPlaybackTimes = await this.prisma.queueItem.findMany({
      where: {
        updated_at: { gte: todayStart },
        started_playing_at: { not: null },
        OR: [
          { finished_at: { not: null } },
          { skipped_at: { not: null } },
        ],
      },
      select: { started_playing_at: true, finished_at: true, skipped_at: true },
      take: 50,
      orderBy: { updated_at: "desc" },
    });

    let avg_play_duration_seconds: number | null = null;
    if (withPlaybackTimes.length > 0) {
      let validCount = 0;
      const totalDuration = withPlaybackTimes.reduce((sum, item) => {
        const end = item.finished_at ?? item.skipped_at;
        if (!end || !item.started_playing_at) return sum;
        const dur = (end.getTime() - item.started_playing_at.getTime()) / 1000;
        if (dur <= 0) return sum;
        validCount++;
        return sum + dur;
      }, 0);
      if (validCount > 0) {
        avg_play_duration_seconds = Math.round(totalDuration / validCount);
      }
    }

    return {
      songs_played_today: played,
      songs_skipped_today: skipped,
      songs_pending: pending,
      total_songs_today: totalSongs,
      avg_wait_seconds,
      avg_play_duration_seconds,
      tables_participating: tablesParticipating.length,
      top_table: topTable[0]
        ? { table_id: topTable[0].table_id, count: topTable[0]._count.id }
        : null,
    };
  }

  async getCurrentPlaying() {
    const item = await this.prisma.queueItem.findFirst({
      where: {
        status: "playing",
      },
      include: queueInclude,
      orderBy: {
        position: "asc",
      },
    });

    return item ? this.serializeQueueItem(item) : null;
  }

  async create(createQueueItemDto: CreateQueueItemDto) {
    const { youtube_id, title, duration, table_id } = createQueueItemDto;

    const table = await this.prisma.table.findUnique({
      where: {
        id: table_id,
      },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${table_id} not found`);
    }

    if (table.status !== TableStatus.occupied) {
      throw new BadRequestException({
        message: "Table must be occupied to add songs to the queue",
        code: "TABLE_NOT_ACTIVE",
      });
    }

    // Validate duration
    if (duration <= 0) {
      throw new BadRequestException({
        message: "Song duration must be greater than 0",
        code: "SONG_INVALID_DURATION",
      });
    }
    if (duration > MAX_SONG_DURATION_SECONDS) {
      throw new BadRequestException({
        message: `Song duration exceeds maximum of ${MAX_SONG_DURATION_SECONDS} seconds (${Math.floor(MAX_SONG_DURATION_SECONDS / 60)} minutes)`,
        code: "SONG_TOO_LONG",
      });
    }

    // Validate max songs per table (pending + playing)
    // Adjust limit based on how many tables are competing
    const activeSongsCount = await this.prisma.queueItem.count({
      where: {
        table_id,
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
      },
    });

    const activeTablesWithQueue = await this.prisma.queueItem.findMany({
      where: { status: { in: [QueueStatus.pending, QueueStatus.playing] }, table_id: { not: null } },
      select: { table_id: true },
      distinct: ["table_id"],
    });
    const activeTableCount = activeTablesWithQueue.length;

    // If only 1 table active: no limit (they're alone, let them queue freely)
    // If 2+ tables: apply limit with unlock options
    if (activeTableCount >= 2 && activeSongsCount >= MAX_SONGS_PER_TABLE) {
      const baseConsumption = MAX_SONGS_PER_TABLE * EXTRA_SONG_CONSUMPTION_THRESHOLD;
      const extraSlotsFromConsumption = Math.floor(
        Math.max(0, this.toNumber(table.total_consumption) - baseConsumption) /
          EXTRA_SONG_CONSUMPTION_THRESHOLD,
      );
      const effectiveLimit = MAX_SONGS_PER_TABLE + extraSlotsFromConsumption;

      if (activeSongsCount >= effectiveLimit) {
        const lastAdded = await this.prisma.queueItem.findFirst({
          where: { table_id, status: { in: [QueueStatus.pending, QueueStatus.playing] } },
          orderBy: { queued_at: "desc" },
          select: { queued_at: true },
        });

        const cooldownExpired = lastAdded
          ? Date.now() - lastAdded.queued_at.getTime() > QUEUE_LIMIT_COOLDOWN_MINUTES * 60 * 1000
          : true;

        if (!cooldownExpired) {
          const minLeft = Math.ceil(
            (QUEUE_LIMIT_COOLDOWN_MINUTES * 60 * 1000 - (Date.now() - lastAdded!.queued_at.getTime())) / 60_000,
          );
          throw new BadRequestException({
            message: `Has alcanzado el límite de canciones. Espera ${minLeft} min o consume $${(EXTRA_SONG_CONSUMPTION_THRESHOLD / 1000).toFixed(0)} mil más para agregar otra`,
            code: "QUEUE_LIMIT_REACHED",
          });
        }
      }
    }

    // Validate no duplicate: song not already pending/playing from any table
    const duplicateInQueue = await this.prisma.queueItem.findFirst({
      where: {
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
        song: { youtube_id },
      },
    });
    if (duplicateInQueue) {
      throw new BadRequestException({
        message: "Esta canción ya está en la cola",
        code: "QUEUE_DUPLICATE",
      });
    }

    // Validate song hasn't been played recently (last 30 minutes)
    const recentlyPlayed = await this.prisma.queueItem.findFirst({
      where: {
        status: QueueStatus.played,
        song: { youtube_id },
        finished_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    if (recentlyPlayed) {
      throw new BadRequestException({
        message: "Esta canción sonó hace poco. Intenta con otra",
        code: "QUEUE_RECENTLY_PLAYED",
      });
    }

    const song = await this.findOrCreateSong({
      youtube_id,
      title,
      duration,
      table_id,
    });

    const queueItem = await this.prisma.$transaction(async (tx) => {
      // Build fairness context
      const ctx = await this.fairnessService.buildContext(tx);

      // Calculate score for the requesting table
      const score = this.fairnessService.calculatePriorityScore(
        table_id,
        this.toNumber(table.total_consumption),
        ctx,
      );

      // Get current pending items to determine insertion position
      const pendingItems = await tx.queueItem.findMany({
        where: { status: QueueStatus.pending },
        orderBy: { position: "asc" },
        select: { id: true, table_id: true, priority_score: true },
      });

      const pendingWithScores = pendingItems.map((item) => ({
        ...item,
        priority_score: Number(item.priority_score),
      }));

      // Find the playing item to know its table (for adjacency check)
      const playingItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.playing },
        select: { id: true, table_id: true },
      });

      // Find where to insert based on fairness
      const insertAt = this.fairnessService.findInsertionPosition(
        table_id,
        score.total,
        pendingWithScores,
        ctx,
        playingItem?.table_id ?? null,
      );

      // Guard against NaN scores breaking Prisma Decimal
      const safeScore = Number.isFinite(score.total) ? score.total : 0;

      // Temporary position — will be fixed below
      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id,
          priority_score: safeScore,
          status: QueueStatus.pending,
          position: 9999,
        },
        include: queueInclude,
      });

      // Reorder: splice the new item at the correct position
      const orderedIds = pendingWithScores.map((p) => p.id);
      orderedIds.splice(insertAt, 0, item.id);

      // Reassign positions: playing item stays at 1, pending starts at 2
      const startPos = playingItem ? 2 : 1;
      if (playingItem) {
        await tx.queueItem.update({
          where: { id: playingItem.id },
          data: { position: 1 },
        });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.queueItem.update({
          where: { id: orderedIds[i] },
          data: { position: startPos + i },
        });
      }

      // Re-fetch with includes
      return tx.queueItem.findUniqueOrThrow({
        where: { id: item.id },
        include: queueInclude,
      });
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(queueItem);
  }

  async playNext() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: { status: QueueStatus.played, finished_at: now, skipped_at: null },
      });

      await this.compactPositions(tx);

      const nextItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.pending },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: { status: QueueStatus.playing, started_playing_at: now },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    if (result) {
      await this.playbackService.setFromQueueItem(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  async skip(id: number) {
    const queueItem = await this.prisma.queueItem.findUnique({
      where: {
        id,
      },
      include: queueInclude,
    });

    if (!queueItem) {
      throw new NotFoundException(`Queue item with ID ${id} not found`);
    }

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      const item = await tx.queueItem.update({
        where: { id },
        data: {
          status: QueueStatus.skipped,
          skipped_at: new Date(),
          finished_at: null,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return item;
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(updatedItem);
  }

  async finishCurrent() {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.queueItem.findFirst({
        where: { status: QueueStatus.playing },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!current) return null;

      const updated = await tx.queueItem.update({
        where: { id: current.id },
        data: {
          status: QueueStatus.played,
          finished_at: new Date(),
          skipped_at: null,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updated;
    });

    await this.playbackService.setPaused();
    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Atomic transition: finish current song and start next one.
   * Single transaction avoids race conditions from two separate calls.
   */
  async advanceToNext() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark current playing as played
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.played,
          finished_at: now,
          skipped_at: null,
        },
      });

      await this.compactPositions(tx);

      // 2. Find and promote next pending item
      const nextItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.pending },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: { status: QueueStatus.playing, started_playing_at: now },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    // 3. Update playback state (buffering until frontend confirms playing)
    if (result) {
      await this.playbackService.setBuffering(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Atomic: skip current playing song and start next one.
   * Single transaction — no partial state if one step fails.
   */
  async skipAndAdvance() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark current playing as skipped
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.skipped,
          skipped_at: now,
          finished_at: null,
        },
      });

      await this.compactPositions(tx);

      // 2. Find and promote next pending item
      const nextItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.pending },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: {
          status: QueueStatus.playing,
          started_playing_at: now,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    if (result) {
      await this.playbackService.setBuffering(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Admin: add song to queue without any restrictions.
   * No duration limit, no max songs, no duplicate check, no table validation.
   * Optionally specify position (default: next in queue).
   */
  async adminCreate(input: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id?: number;
    position?: number;
  }) {
    const tableId = input.table_id ?? null;

    const song = await this.findOrCreateSong({
      youtube_id: input.youtube_id,
      title: input.title,
      duration: input.duration,
      table_id: tableId,
    });

    const queueItem = await this.prisma.$transaction(async (tx) => {
      // Get target position
      const targetPosition = input.position ?? null;

      if (targetPosition) {
        // Shift existing items at and after target position
        await tx.queueItem.updateMany({
          where: {
            status: { in: [QueueStatus.pending, QueueStatus.playing] },
            position: { gte: targetPosition },
          },
          data: { position: { increment: 1 } },
        });
      }

      const maxPos = await tx.queueItem.aggregate({
        where: { status: { in: [QueueStatus.pending, QueueStatus.playing] } },
        _max: { position: true },
      });

      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id: tableId,
          priority_score: 9999,
          status: QueueStatus.pending,
          position: targetPosition ?? (maxPos._max.position ?? 0) + 1,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return tx.queueItem.findUniqueOrThrow({
        where: { id: item.id },
        include: queueInclude,
      });
    });

    await this.broadcastQueueUpdate();
    return this.serializeQueueItem(queueItem);
  }

  /**
   * Admin: interrupt current playback and play this song immediately.
   * Finishes (or skips) the current song, inserts the new one, and starts it.
   */
  async adminPlayNow(input: {
    youtube_id: string;
    title: string;
    duration: number;
  }) {
    const song = await this.findOrCreateSong({
      youtube_id: input.youtube_id,
      title: input.title,
      duration: input.duration,
      table_id: null,
    });

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Finish current playing song
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.played,
          finished_at: now,
          skipped_at: null,
        },
      });

      // 2. Shift all pending items by 1
      await tx.queueItem.updateMany({
        where: {
          status: QueueStatus.pending,
        },
        data: { position: { increment: 1 } },
      });

      // 3. Create new item at position 1 as playing
      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id: null,
          priority_score: 9999,
          status: QueueStatus.playing,
          position: 1,
          started_playing_at: now,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return item;
    });

    await this.playbackService.setBuffering(result);
    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(result);
  }

  private serializeQueueItem(item: QueueRecord) {
    return {
      ...item,
      priority_score: this.toNumber(item.priority_score),
      table: item.table
        ? {
            ...item.table,
            total_consumption: this.toNumber(item.table.total_consumption),
          }
        : null,
    };
  }

  private toNumber(value: Prisma.Decimal | number) {
    return Number(value);
  }

  private async compactPositions(tx: Prisma.TransactionClient) {
    const activeItems = await tx.queueItem.findMany({
      where: { status: { in: [QueueStatus.playing, QueueStatus.pending] } },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    for (let i = 0; i < activeItems.length; i++) {
      await tx.queueItem.update({
        where: { id: activeItems[i].id },
        data: { position: i + 1 },
      });
    }
  }

  private async broadcastQueueUpdate() {
    const queue = await this.findGlobal();
    this.realtimeGateway.emitQueueUpdated(queue);
  }

  private async findOrCreateSong(input: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number | null;
  }) {
    const existingSong = await this.prisma.song.findUnique({
      where: {
        youtube_id: input.youtube_id,
      },
    });

    if (existingSong) {
      return existingSong;
    }

    return this.prisma.song.create({
      data: {
        youtube_id: input.youtube_id,
        title: input.title,
        duration: input.duration,
        requested_by_table: input.table_id,
      },
    });
  }
}
