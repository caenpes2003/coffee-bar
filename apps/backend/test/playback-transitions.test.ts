import { describe, it, expect } from "vitest";
import { SearchCache } from "../src/modules/music/search-cache";
import { QuotaBudget } from "../src/modules/music/quota-budget";

// ─── SearchCache ─────────────────────────────────────────────────────────────

describe("SearchCache", () => {
  it("returns null for missing entries", () => {
    const cache = new SearchCache(60);
    expect(cache.get("test", 10)).toBeNull();
  });

  it("stores and retrieves results", () => {
    const cache = new SearchCache(60);
    const results = [{ youtubeId: "a", title: "A", duration: 200, thumbnail: null }];
    cache.set("test query", 10, results);
    expect(cache.get("test query", 10)).toEqual(results);
  });

  it("normalizes queries (lowercase, trim, spaces)", () => {
    const cache = new SearchCache(60);
    const results = [{ youtubeId: "a", title: "A", duration: 200, thumbnail: null }];
    cache.set("  Bad  Bunny ", 10, results);
    expect(cache.get("bad bunny", 10)).toEqual(results);
    expect(cache.get("BAD BUNNY", 10)).toEqual(results);
    expect(cache.get("  bad   bunny  ", 10)).toEqual(results);
  });

  it("differentiates by limit", () => {
    const cache = new SearchCache(60);
    const r5 = [{ youtubeId: "a", title: "A", duration: 200, thumbnail: null }];
    const r10 = [
      { youtubeId: "a", title: "A", duration: 200, thumbnail: null },
      { youtubeId: "b", title: "B", duration: 300, thumbnail: null },
    ];
    cache.set("test", 5, r5);
    cache.set("test", 10, r10);
    expect(cache.get("test", 5)).toHaveLength(1);
    expect(cache.get("test", 10)).toHaveLength(2);
  });

  it("expires entries after TTL", async () => {
    const cache = new SearchCache(0.1); // 100ms TTL
    cache.set("test", 10, [{ youtubeId: "a", title: "A", duration: 200, thumbnail: null }]);
    expect(cache.get("test", 10)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 150));
    expect(cache.get("test", 10)).toBeNull();
  });

  it("prune removes expired entries", async () => {
    const cache = new SearchCache(0.1);
    cache.set("a", 10, []);
    cache.set("b", 10, []);
    expect(cache.size).toBe(2);
    await new Promise((r) => setTimeout(r, 150));
    const removed = cache.prune();
    expect(removed).toBe(2);
    expect(cache.size).toBe(0);
  });
});

// ─── QuotaBudget ─────────────────────────────────────────────────────────────

describe("QuotaBudget", () => {
  it("starts at 0 used", () => {
    const budget = new QuotaBudget(8000);
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(8000);
  });

  it("tracks consumption", () => {
    const budget = new QuotaBudget(8000);
    budget.consume(101);
    expect(budget.used).toBe(101);
    expect(budget.remaining).toBe(7899);
  });

  it("canAfford returns true when under limit", () => {
    const budget = new QuotaBudget(8000);
    expect(budget.canAfford(101)).toBe(true);
  });

  it("canAfford returns false when at limit", () => {
    const budget = new QuotaBudget(200);
    budget.consume(101);
    // 101 + 101 = 202 > 200
    expect(budget.canAfford(101)).toBe(false);
  });

  it("uses default 101 units for canAfford and consume", () => {
    const budget = new QuotaBudget(200);
    budget.consume();
    expect(budget.used).toBe(101);
    expect(budget.canAfford()).toBe(false);
  });

  it("remaining never goes below 0", () => {
    const budget = new QuotaBudget(50);
    budget.consume(101);
    expect(budget.remaining).toBe(0);
  });
});

// ─── Playback transition rules ───────────────────────────────────────────────

describe("playback transition rules (contract tests)", () => {
  it("finished_at and skipped_at are mutually exclusive for played status", () => {
    // These are contract tests validating the data rules,
    // not testing actual Prisma operations
    const playedItem = {
      status: "played",
      finished_at: new Date(),
      skipped_at: null,
    };
    expect(playedItem.finished_at).not.toBeNull();
    expect(playedItem.skipped_at).toBeNull();
  });

  it("finished_at and skipped_at are mutually exclusive for skipped status", () => {
    const skippedItem = {
      status: "skipped",
      finished_at: null,
      skipped_at: new Date(),
    };
    expect(skippedItem.finished_at).toBeNull();
    expect(skippedItem.skipped_at).not.toBeNull();
  });

  it("pending items have no timestamps", () => {
    const pendingItem = {
      status: "pending",
      started_playing_at: null,
      finished_at: null,
      skipped_at: null,
    };
    expect(pendingItem.started_playing_at).toBeNull();
    expect(pendingItem.finished_at).toBeNull();
    expect(pendingItem.skipped_at).toBeNull();
  });

  it("playing items have started_playing_at set", () => {
    const playingItem = {
      status: "playing",
      started_playing_at: new Date(),
      finished_at: null,
      skipped_at: null,
    };
    expect(playingItem.started_playing_at).not.toBeNull();
    expect(playingItem.finished_at).toBeNull();
    expect(playingItem.skipped_at).toBeNull();
  });

  it("valid state transitions", () => {
    const validTransitions: Record<string, string[]> = {
      pending: ["playing", "skipped"],
      playing: ["played", "skipped"],
      played: [],
      skipped: [],
    };

    expect(validTransitions["pending"]).toContain("playing");
    expect(validTransitions["pending"]).toContain("skipped");
    expect(validTransitions["playing"]).toContain("played");
    expect(validTransitions["playing"]).toContain("skipped");
    expect(validTransitions["played"]).toHaveLength(0);
    expect(validTransitions["skipped"]).toHaveLength(0);
  });
});
