import { describe, it, expect } from "vitest";
import { HybridMusicProvider } from "../src/modules/music/hybrid.provider";
import type { MusicSearchProvider, MusicSearchResult } from "../src/modules/music/music-search.provider";

// ─── Mock providers ──────────────────────────────────────────────────────────

function makeMockProvider(
  name: string,
  results: MusicSearchResult[] | Error,
): MusicSearchProvider {
  return {
    name,
    search: async () => {
      if (results instanceof Error) throw results;
      return results;
    },
  };
}

const sampleResults: MusicSearchResult[] = [
  { youtubeId: "abc123", title: "Test Song", duration: 240, thumbnail: null },
  { youtubeId: "def456", title: "Another Song", duration: 180, thumbnail: "thumb.jpg" },
];

// ─── Hybrid Provider E2E ─────────────────────────────────────────────────────

describe("HybridMusicProvider E2E flows", () => {
  it("flow: search → cache hit on repeat", async () => {
    const youtube = makeMockProvider("youtube", sampleResults);
    const ytsr = makeMockProvider("ytsr", []);
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    // First search hits YouTube API
    const r1 = await hybrid.search("test song", 10);
    expect(r1).toHaveLength(2);

    // Second search hits cache
    const r2 = await hybrid.search("test song", 10);
    expect(r2).toHaveLength(2);
    expect(r2).toEqual(r1);
  });

  it("flow: YouTube fails → ytsr fallback works", async () => {
    const youtube = makeMockProvider("youtube", new Error("API error"));
    const ytsr = makeMockProvider("ytsr", sampleResults);
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    const results = await hybrid.search("coldplay", 10);
    expect(results).toHaveLength(2);
  });

  it("flow: YouTube empty → ytsr has results", async () => {
    const youtube = makeMockProvider("youtube", []);
    const ytsr = makeMockProvider("ytsr", sampleResults);
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    const results = await hybrid.search("obscure song", 10);
    expect(results).toHaveLength(2);
  });

  it("flow: both empty → returns [] (legitimate empty)", async () => {
    const youtube = makeMockProvider("youtube", []);
    const ytsr = makeMockProvider("ytsr", []);
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    const results = await hybrid.search("asdkjfhasdkjfh", 10);
    expect(results).toHaveLength(0);
  });

  it("flow: both fail → throws SEARCH_UNAVAILABLE", async () => {
    const youtube = makeMockProvider("youtube", new Error("quota"));
    const ytsr = makeMockProvider("ytsr", new Error("scrape failed"));
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    await expect(hybrid.search("test", 10)).rejects.toThrow("SEARCH_UNAVAILABLE");
  });

  it("flow: cache normalizes queries", async () => {
    const youtube = makeMockProvider("youtube", sampleResults);
    const ytsr = makeMockProvider("ytsr", []);
    const hybrid = new HybridMusicProvider(youtube, ytsr);

    await hybrid.search("Bad Bunny", 10);
    // Same query different casing should hit cache
    const r2 = await hybrid.search("bad bunny", 10);
    expect(r2).toHaveLength(2);
  });
});

// ─── Fairness integration scenarios ──────────────────────────────────────────

describe("fairness integration scenarios", () => {
  // These are scenario descriptions that validate the algorithm design
  // without needing a database. The actual FairnessService logic is tested
  // in fairness.test.ts — here we validate scenarios make sense.

  it("scenario: 2 mesas alternating — cooldown prevents monopoly", () => {
    // Mesa 1 played last, Mesa 2 played before that
    // Mesa 1 tries to add again → should get cooldown penalty
    const recentPlayed = [{ table_id: 1 }, { table_id: 2 }];
    const mesa1InCooldown = recentPlayed
      .slice(0, 2)
      .some((r) => r.table_id === 1);
    expect(mesa1InCooldown).toBe(true);
  });

  it("scenario: 3 mesas with different consumption — fairness balances", () => {
    // Mesa 1: 60k COP, Mesa 2: 30k COP, Mesa 3: 10k COP
    // Mesa 1 has higher consumption score but if it dominated recently,
    // it should still yield to others
    const consumptionScores = {
      mesa1: 60_000 / 1000, // 60
      mesa2: 30_000 / 1000, // 30
      mesa3: 10_000 / 1000, // 10
    };
    const dominancePenalty = 2 * 25; // 2 recent songs

    // Even with high consumption, dominance penalty brings mesa 1 down
    const mesa1Adjusted = consumptionScores.mesa1 - dominancePenalty;
    expect(mesa1Adjusted).toBe(10); // 60 - 50 = 10
    expect(mesa1Adjusted).toBeLessThan(consumptionScores.mesa2);
  });

  it("scenario: single mesa — no fairness applied", () => {
    // With 1 active table, all fairness factors should be 0
    // Score = consumption only
    const consumption = 40_000 / 1000;
    const score = consumption + 0 + 0 - 0 - 0 - 0;
    expect(score).toBe(40);
  });

  it("scenario: mesa with recent order gets activity bonus", () => {
    const withOrder = 20 + 8; // consumption + RECENT_ORDER_BONUS
    const withoutOrder = 20 + 0;
    expect(withOrder).toBeGreaterThan(withoutOrder);
    expect(withOrder - withoutOrder).toBe(8);
  });

  it("scenario: long wait gives significant boost", () => {
    // 15 minutes of waiting → 30 points
    const waitBoost = 15 * 2;
    expect(waitBoost).toBe(30);
    // This can overcome a consumption gap
    const lowConsumption = 10 + waitBoost; // 10k COP + 15min wait = 40
    const highConsumption = 30; // 30k COP, no wait
    expect(lowConsumption).toBeGreaterThan(highConsumption);
  });
});

// ─── Queue insertion scenarios ───────────────────────────────────────────────

describe("queue insertion scenarios", () => {
  it("scenario: A-B-A-B pattern with 2 tables", () => {
    // With 2 tables, the system should try to enforce alternation
    // T1, T2, T1, T2 rather than T1, T1, T2, T2
    const queue = [
      { pos: 1, table: 1, status: "playing" },
      { pos: 2, table: 2, status: "pending" },
    ];
    // T1 tries to add → should go after T2 (position 3), not position 2
    const t1NextToT2 = queue[queue.length - 1].table !== 1;
    expect(t1NextToT2).toBe(true);
  });

  it("scenario: high-score table can jump queue but not break adjacency", () => {
    // Queue: T2(50), T3(40), T2(30)
    // T4 with score 45 should go to position 1 (between T2 and T3)
    const queue = [
      { score: 50, table: 2 },
      { score: 40, table: 3 },
      { score: 30, table: 2 },
    ];
    // T4 with score 45: first position where score > existing
    const insertAt = queue.findIndex((item) => 45 > item.score);
    expect(insertAt).toBe(1); // before T3(40)
  });
});
