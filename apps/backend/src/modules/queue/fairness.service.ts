import { Injectable } from "@nestjs/common";
import { Prisma, QueueStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import {
  PRIORITY_SCORE_DIVISOR,
  WAIT_SCORE_PER_MINUTE,
  RECENT_ORDER_BONUS,
  RECENT_ORDER_WINDOW_MINUTES,
  COOLDOWN_SLOTS,
  COOLDOWN_PENALTY,
  DOMINANCE_WINDOW,
  DOMINANCE_PENALTY_PER_SONG,
  QUEUE_LOAD_PENALTY,
} from "@coffee-bar/shared";

// ─── Types ──────���────────────────────────────────────────────────────────────

export interface FairnessConfig {
  cooldownSlots: number;
  dominanceWindow: number;
  dominancePenaltyPerSong: number;
  queueLoadPenalty: number;
  waitScorePerMinute: number;
  recentOrderBonus: number;
  cooldownPenalty: number;
}

export interface FairnessContext {
  config: FairnessConfig;
  recentPlayed: { table_id: number }[];
  activeQueueByTable: Map<number, number>;
  lastPlayedAtByTable: Map<number, Date>;
  tablesWithRecentOrders: Set<number>;
  activeTablesCount: number;
}

interface ScoreBreakdown {
  consumption: number;
  wait: number;
  activity: number;
  cooldown: number;
  dominance: number;
  queueLoad: number;
  total: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class FairnessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns adaptive config based on how many tables are actively participating.
   */
  getFairnessConfig(activeTablesCount: number): FairnessConfig {
    if (activeTablesCount <= 1) {
      // Single table: no fairness needed, just basic limits
      return {
        cooldownSlots: 0,
        dominanceWindow: 0,
        dominancePenaltyPerSong: 0,
        queueLoadPenalty: 0,
        waitScorePerMinute: 0,
        recentOrderBonus: 0,
        cooldownPenalty: 0,
      };
    }

    if (activeTablesCount === 2) {
      // Two tables: strong alternation
      return {
        cooldownSlots: COOLDOWN_SLOTS,
        dominanceWindow: 4,
        dominancePenaltyPerSong: DOMINANCE_PENALTY_PER_SONG * 1.5,
        queueLoadPenalty: QUEUE_LOAD_PENALTY,
        waitScorePerMinute: WAIT_SCORE_PER_MINUTE,
        recentOrderBonus: RECENT_ORDER_BONUS,
        cooldownPenalty: COOLDOWN_PENALTY * 1.5,
      };
    }

    // 3+ tables: full weighted fairness
    return {
      cooldownSlots: COOLDOWN_SLOTS,
      dominanceWindow: DOMINANCE_WINDOW,
      dominancePenaltyPerSong: DOMINANCE_PENALTY_PER_SONG,
      queueLoadPenalty: QUEUE_LOAD_PENALTY,
      waitScorePerMinute: WAIT_SCORE_PER_MINUTE,
      recentOrderBonus: RECENT_ORDER_BONUS,
      cooldownPenalty: COOLDOWN_PENALTY,
    };
  }

  /**
   * Build the full fairness context needed to score any table.
   */
  async buildContext(tx?: Prisma.TransactionClient): Promise<FairnessContext> {
    const db = tx ?? this.prisma;

    // 1. Count active tables (have pending/playing songs or recent orders)
    const tablesWithQueue = await db.queueItem.findMany({
      where: { status: { in: [QueueStatus.pending, QueueStatus.playing] } },
      select: { table_id: true },
      distinct: ["table_id"],
    });

    const recentOrderCutoff = new Date(
      Date.now() - RECENT_ORDER_WINDOW_MINUTES * 60 * 1000,
    );

    const tablesWithOrders = await db.order.findMany({
      where: { created_at: { gte: recentOrderCutoff } },
      select: { table_id: true },
      distinct: ["table_id"],
    });

    const activeTableIds = new Set([
      ...tablesWithQueue.map((t) => t.table_id),
      ...tablesWithOrders.map((t) => t.table_id),
    ]);

    const activeTablesCount = activeTableIds.size;
    const config = this.getFairnessConfig(activeTablesCount);

    // 2. Recent played songs (for cooldown + dominance), excluding admin (null table_id)
    const recentPlayedRaw = await db.queueItem.findMany({
      where: { status: QueueStatus.played, table_id: { not: null } },
      orderBy: { updated_at: "desc" },
      take: Math.max(config.cooldownSlots, config.dominanceWindow),
      select: { table_id: true, updated_at: true },
    });
    const recentPlayed = recentPlayedRaw.filter(
      (item): item is { table_id: number; updated_at: Date } => item.table_id != null,
    );

    // 3. Active queue items per table (skip admin songs with null table_id)
    const activeQueueItems = await db.queueItem.findMany({
      where: { status: { in: [QueueStatus.pending, QueueStatus.playing] } },
      select: { table_id: true },
    });

    const activeQueueByTable = new Map<number, number>();
    for (const item of activeQueueItems) {
      if (item.table_id == null) continue;
      activeQueueByTable.set(
        item.table_id,
        (activeQueueByTable.get(item.table_id) ?? 0) + 1,
      );
    }

    // 4. Last played time per table
    const lastPlayedAtByTable = new Map<number, Date>();
    for (const item of recentPlayed) {
      if (item.table_id == null) continue;
      if (!lastPlayedAtByTable.has(item.table_id)) {
        lastPlayedAtByTable.set(item.table_id, item.updated_at);
      }
    }

    // 5. Tables with recent orders
    const tablesWithRecentOrders = new Set(
      tablesWithOrders.map((t) => t.table_id),
    );

    return {
      config,
      recentPlayed,
      activeQueueByTable,
      lastPlayedAtByTable,
      tablesWithRecentOrders,
      activeTablesCount,
    };
  }

  /**
   * Check if a table is in cooldown (appeared in the last N played songs).
   */
  isTableInCooldown(tableId: number, ctx: FairnessContext): boolean {
    if (ctx.config.cooldownSlots === 0) return false;

    const recentSlots = ctx.recentPlayed.slice(0, ctx.config.cooldownSlots);
    return recentSlots.some((item) => item.table_id === tableId);
  }

  /**
   * Count how many songs a table had in the recent dominance window.
   */
  countRecentSongsByTable(tableId: number, ctx: FairnessContext): number {
    if (ctx.config.dominanceWindow === 0) return 0;

    const window = ctx.recentPlayed.slice(0, ctx.config.dominanceWindow);
    return window.filter((item) => item.table_id === tableId).length;
  }

  /**
   * Calculate the priority score for a table.
   */
  calculatePriorityScore(
    tableId: number,
    totalConsumption: number,
    ctx: FairnessContext,
  ): ScoreBreakdown {
    const { config } = ctx;

    // 1. Consumption score
    const consumption = totalConsumption / PRIORITY_SCORE_DIVISOR;

    // 2. Wait score
    const lastPlayed = ctx.lastPlayedAtByTable.get(tableId);
    const minutesSinceLastPlayed = lastPlayed
      ? (Date.now() - lastPlayed.getTime()) / 60_000
      : 30; // default: never played = 30 min bonus
    const wait = minutesSinceLastPlayed * config.waitScorePerMinute;

    // 3. Activity score
    const activity = ctx.tablesWithRecentOrders.has(tableId)
      ? config.recentOrderBonus
      : 0;

    // 4. Cooldown penalty
    const cooldown = this.isTableInCooldown(tableId, ctx)
      ? config.cooldownPenalty
      : 0;

    // 5. Dominance penalty
    const recentSongs = this.countRecentSongsByTable(tableId, ctx);
    const dominance = recentSongs * config.dominancePenaltyPerSong;

    // 6. Queue load penalty
    const activeItems = ctx.activeQueueByTable.get(tableId) ?? 0;
    const queueLoad = activeItems * config.queueLoadPenalty;

    const total = consumption + wait + activity - cooldown - dominance - queueLoad;

    return { consumption, wait, activity, cooldown, dominance, queueLoad, total };
  }

  /**
   * Find the correct insertion position for a new queue item.
   * Respects cooldown and anti-monopoly constraints.
   *
   * @param playingTableId - table_id of the currently playing song (if any),
   *   so we avoid placing the new item right after it if it's the same table.
   */
  findInsertionPosition(
    newTableId: number,
    newScore: number,
    pendingItems: { id: number; table_id: number | null; priority_score: number }[],
    ctx: FairnessContext,
    playingTableId?: number | null,
  ): number {
    // Single table mode: always append at the end
    if (ctx.activeTablesCount <= 1) {
      return pendingItems.length;
    }

    // Count how many pending songs each table has in total (skip admin: null)
    const countByTable = new Map<number, number>();
    for (const item of pendingItems) {
      if (item.table_id != null) {
        countByTable.set(item.table_id, (countByTable.get(item.table_id) ?? 0) + 1);
      }
    }
    const newTableCount = countByTable.get(newTableId) ?? 0;

    // Track how many songs from each table we've seen so far as we scan
    const seenByTable = new Map<number, number>();

    for (let i = 0; i < pendingItems.length; i++) {
      const existing = pendingItems[i];
      const existingTableId = existing.table_id;

      // Admin songs (null table_id) — don't insert before them, just skip
      if (existingTableId == null) {
        continue;
      }

      // Determine the table of the item "before" this position
      const prevTableId =
        i === 0 ? (playingTableId ?? null) : pendingItems[i - 1].table_id;

      // Don't insert if the previous item is from the same table (avoids consecutive)
      if (prevTableId === newTableId) {
        seenByTable.set(existingTableId, (seenByTable.get(existingTableId) ?? 0) + 1);
        continue;
      }

      // Don't insert before an item from the same table (avoids consecutive)
      if (existingTableId === newTableId) {
        seenByTable.set(existingTableId, (seenByTable.get(existingTableId) ?? 0) + 1);
        continue;
      }

      // How many songs from the existing item's table have we already passed?
      const existingTableSeen = seenByTable.get(existingTableId) ?? 0;

      // Balancing rule: if the other table already has more songs queued than us,
      // and we've passed at least one of theirs, insert here.
      // This ensures: A1, B1, A2, B2, A3, B3... pattern
      const otherTableTotal = countByTable.get(existingTableId) ?? 0;
      if (otherTableTotal > newTableCount && existingTableSeen >= 1) {
        return i;
      }

      // Insert here if the new score is higher
      if (newScore > existing.priority_score) {
        return i;
      }

      seenByTable.set(existingTableId, existingTableSeen + 1);
    }

    return pendingItems.length;
  }
}
