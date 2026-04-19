import { describe, it, expect, vi, beforeEach } from "vitest";
import { FairnessService, FairnessContext } from "../src/modules/queue/fairness.service";

// Mock PrismaService — not needed for pure logic tests
const mockPrisma = {} as any;

function createService(): FairnessService {
  return new FairnessService(mockPrisma);
}

function makeContext(overrides: Partial<FairnessContext> = {}): FairnessContext {
  const svc = createService();
  const activeTablesCount = overrides.activeTablesCount ?? 3;
  const config = svc.getFairnessConfig(activeTablesCount);
  const base: FairnessContext = {
    config,
    recentPlayed: [],
    activeQueueByTable: new Map(),
    lastPlayedAtByTable: new Map(),
    tablesWithRecentOrders: new Set(),
    activeTablesCount,
  };
  // Apply overrides but keep config derived from activeTablesCount
  return { ...base, ...overrides, config };
}

// ─── getFairnessConfig ───────────────────────────────────────────────────────

describe("getFairnessConfig", () => {
  const svc = createService();

  it("returns zero config for 1 table", () => {
    const config = svc.getFairnessConfig(1);
    expect(config.cooldownSlots).toBe(0);
    expect(config.dominanceWindow).toBe(0);
    expect(config.cooldownPenalty).toBe(0);
    expect(config.dominancePenaltyPerSong).toBe(0);
    expect(config.queueLoadPenalty).toBe(0);
    expect(config.waitScorePerMinute).toBe(0);
  });

  it("returns zero config for 0 tables", () => {
    const config = svc.getFairnessConfig(0);
    expect(config.cooldownSlots).toBe(0);
  });

  it("returns strong alternation config for 2 tables", () => {
    const config = svc.getFairnessConfig(2);
    expect(config.cooldownSlots).toBe(2);
    expect(config.dominanceWindow).toBe(4);
    // Amplified penalties
    expect(config.cooldownPenalty).toBe(150);
    expect(config.dominancePenaltyPerSong).toBe(37.5);
  });

  it("returns full fairness config for 3+ tables", () => {
    const config = svc.getFairnessConfig(3);
    expect(config.cooldownSlots).toBe(2);
    expect(config.dominanceWindow).toBe(5);
    expect(config.cooldownPenalty).toBe(100);
    expect(config.dominancePenaltyPerSong).toBe(25);
    expect(config.queueLoadPenalty).toBe(15);
  });

  it("returns same config for 5 tables as for 3", () => {
    const c3 = svc.getFairnessConfig(3);
    const c5 = svc.getFairnessConfig(5);
    expect(c3).toEqual(c5);
  });
});

// ─── isTableInCooldown ───────────────────────────────────────────────────────

describe("isTableInCooldown", () => {
  const svc = createService();

  it("returns false when cooldownSlots is 0 (1 table)", () => {
    const ctx = makeContext({ activeTablesCount: 1 });
    ctx.config = svc.getFairnessConfig(1);
    ctx.recentPlayed = [{ table_id: 1 }];
    expect(svc.isTableInCooldown(1, ctx)).toBe(false);
  });

  it("returns true if table appeared in recent slots", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 1 }, { table_id: 2 }],
    });
    expect(svc.isTableInCooldown(1, ctx)).toBe(true);
  });

  it("returns false if table is outside cooldown window", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 2 }, { table_id: 3 }, { table_id: 1 }],
    });
    // cooldownSlots = 2, so only checks first 2: [2, 3]
    expect(svc.isTableInCooldown(1, ctx)).toBe(false);
  });

  it("returns true if table is in first slot", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 5 }, { table_id: 3 }],
    });
    expect(svc.isTableInCooldown(5, ctx)).toBe(true);
  });

  it("returns false for empty recentPlayed", () => {
    const ctx = makeContext({ recentPlayed: [] });
    expect(svc.isTableInCooldown(1, ctx)).toBe(false);
  });
});

// ─── countRecentSongsByTable ─────────────────────────────────────────────────

describe("countRecentSongsByTable", () => {
  const svc = createService();

  it("returns 0 when dominanceWindow is 0 (1 table)", () => {
    const ctx = makeContext({ activeTablesCount: 1 });
    ctx.config = svc.getFairnessConfig(1);
    ctx.recentPlayed = [{ table_id: 1 }, { table_id: 1 }, { table_id: 1 }];
    expect(svc.countRecentSongsByTable(1, ctx)).toBe(0);
  });

  it("counts songs within window", () => {
    const ctx = makeContext({
      recentPlayed: [
        { table_id: 1 },
        { table_id: 2 },
        { table_id: 1 },
        { table_id: 3 },
        { table_id: 1 },
      ],
    });
    // window = 5, table 1 appears 3 times
    expect(svc.countRecentSongsByTable(1, ctx)).toBe(3);
  });

  it("returns 0 for table not in window", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 1 }, { table_id: 2 }],
    });
    expect(svc.countRecentSongsByTable(3, ctx)).toBe(0);
  });
});

// ─── calculatePriorityScore ──────────────────────────────────────────────────

describe("calculatePriorityScore", () => {
  const svc = createService();

  it("calculates consumption score correctly", () => {
    const ctx = makeContext();
    const score = svc.calculatePriorityScore(1, 40_000, ctx);
    expect(score.consumption).toBe(40); // 40000 / 1000
  });

  it("gives 30min wait bonus to table that never played", () => {
    const ctx = makeContext(); // empty lastPlayedAtByTable
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.wait).toBe(60); // 30 * 2
  });

  it("calculates wait score from last played time", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const ctx = makeContext({
      lastPlayedAtByTable: new Map([[1, tenMinAgo]]),
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    // ~10 min * 2 = ~20
    expect(score.wait).toBeGreaterThan(19);
    expect(score.wait).toBeLessThan(21);
  });

  it("adds activity bonus for recent orders", () => {
    const ctx = makeContext({
      tablesWithRecentOrders: new Set([1]),
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.activity).toBe(8);
  });

  it("no activity bonus if no recent order", () => {
    const ctx = makeContext();
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.activity).toBe(0);
  });

  it("applies cooldown penalty when in cooldown", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 1 }, { table_id: 2 }],
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.cooldown).toBe(100);
  });

  it("no cooldown penalty when not in cooldown", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 2 }, { table_id: 3 }],
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.cooldown).toBe(0);
  });

  it("applies dominance penalty based on recent songs", () => {
    const ctx = makeContext({
      recentPlayed: [
        { table_id: 1 },
        { table_id: 2 },
        { table_id: 1 },
        { table_id: 3 },
        { table_id: 1 },
      ],
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.dominance).toBe(75); // 3 * 25
  });

  it("applies queue load penalty", () => {
    const ctx = makeContext({
      activeQueueByTable: new Map([[1, 2]]),
    });
    const score = svc.calculatePriorityScore(1, 0, ctx);
    expect(score.queueLoad).toBe(30); // 2 * 15
  });

  it("total score combines all factors", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 1 }],
      activeQueueByTable: new Map([[1, 1]]),
      tablesWithRecentOrders: new Set([1]),
    });
    const score = svc.calculatePriorityScore(1, 20_000, ctx);
    // consumption=20, wait=30min*2=60, activity=8, cooldown=100, dominance=25, queueLoad=15
    expect(score.total).toBeCloseTo(20 + 60 + 8 - 100 - 25 - 15, 0);
  });

  it("high-consumption table still loses to cooldown", () => {
    const ctx = makeContext({
      recentPlayed: [{ table_id: 1 }, { table_id: 2 }],
    });
    const highConsumption = svc.calculatePriorityScore(1, 60_000, ctx);
    const lowConsumption = svc.calculatePriorityScore(3, 10_000, ctx);
    // Table 1: 60 + wait - 100 (cooldown)
    // Table 3: 10 + wait + 0
    expect(lowConsumption.total).toBeGreaterThan(highConsumption.total);
  });
});

// ─── findInsertionPosition ───────────────────────────────────────────────────

describe("findInsertionPosition", () => {
  const svc = createService();

  it("appends to end for single table mode", () => {
    const ctx = makeContext({ activeTablesCount: 1 });
    ctx.config = svc.getFairnessConfig(1);
    const pending = [
      { id: 1, table_id: 1, priority_score: 50 },
      { id: 2, table_id: 1, priority_score: 40 },
    ];
    const pos = svc.findInsertionPosition(1, 100, pending, ctx);
    expect(pos).toBe(2);
  });

  it("inserts before lower-score item", () => {
    const ctx = makeContext();
    const pending = [
      { id: 1, table_id: 2, priority_score: 50 },
      { id: 2, table_id: 3, priority_score: 30 },
    ];
    // Table 1 with score 40 — should go before item with score 30
    const pos = svc.findInsertionPosition(1, 40, pending, ctx);
    expect(pos).toBe(1);
  });

  it("appends to end if score is lowest", () => {
    const ctx = makeContext();
    const pending = [
      { id: 1, table_id: 2, priority_score: 50 },
      { id: 2, table_id: 3, priority_score: 40 },
    ];
    const pos = svc.findInsertionPosition(1, 10, pending, ctx);
    expect(pos).toBe(2);
  });

  it("avoids consecutive songs from same table (prev item)", () => {
    const ctx = makeContext();
    const pending = [
      { id: 1, table_id: 1, priority_score: 30 },
      { id: 2, table_id: 2, priority_score: 20 },
    ];
    // Table 1 with score 100 — can't go at position 1 (after item from table 1)
    const pos = svc.findInsertionPosition(1, 100, pending, ctx);
    // Should skip position 0 (existing.table_id === newTableId)
    // Position 1: prev is table 1, so skip
    // Position 2: end
    expect(pos).toBe(2);
  });

  it("avoids placing after playing song from same table", () => {
    const ctx = makeContext();
    const pending = [
      { id: 2, table_id: 2, priority_score: 20 },
    ];
    // Playing table is 1, new table is 1 → can't insert at position 0
    const pos = svc.findInsertionPosition(1, 100, pending, ctx, 1);
    expect(pos).toBe(1);
  });

  it("inserts at 0 when playing table is different", () => {
    const ctx = makeContext();
    const pending = [
      { id: 2, table_id: 2, priority_score: 20 },
    ];
    const pos = svc.findInsertionPosition(1, 100, pending, ctx, 3);
    expect(pos).toBe(0);
  });

  it("handles empty pending list", () => {
    const ctx = makeContext();
    const pos = svc.findInsertionPosition(1, 50, [], ctx);
    expect(pos).toBe(0);
  });

  it("ensures diversity in multi-table scenario", () => {
    const ctx = makeContext();
    // Queue: T2, T3, T2
    const pending = [
      { id: 1, table_id: 2, priority_score: 50 },
      { id: 2, table_id: 3, priority_score: 40 },
      { id: 3, table_id: 2, priority_score: 30 },
    ];
    // Table 4 with score 45 → should go between T2 and T3 (position 1)
    const pos = svc.findInsertionPosition(4, 45, pending, ctx);
    expect(pos).toBe(1);
  });
});
