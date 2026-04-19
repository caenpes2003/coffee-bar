/**
 * In-memory daily quota budget tracker for YouTube Data API.
 *
 * Each search = ~101 units (100 for /search + 1 for /videos).
 * Free tier = 10,000 units/day.
 *
 * Reset criterion: server-local midnight (ISO date change).
 * YouTube's official quota resets at midnight Pacific Time, so this
 * is an operational approximation. For production accuracy, align
 * with PT or track via the API's 403 quota-exceeded response.
 *
 * LIMITATION: Per-process counter. Multiple instances will each
 * track independently. Migrate to Redis or DB for shared tracking.
 */
export class QuotaBudget {
  private usedUnits = 0;
  private resetDate: string; // YYYY-MM-DD

  constructor(private readonly softLimit: number) {
    this.resetDate = this.today();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private ensureCurrentDay(): void {
    const now = this.today();
    if (now !== this.resetDate) {
      this.usedUnits = 0;
      this.resetDate = now;
    }
  }

  /** Check if we can afford a search (101 units) */
  canAfford(units = 101): boolean {
    this.ensureCurrentDay();
    return this.usedUnits + units <= this.softLimit;
  }

  /** Record units consumed */
  consume(units = 101): void {
    this.ensureCurrentDay();
    this.usedUnits += units;
  }

  get used(): number {
    this.ensureCurrentDay();
    return this.usedUnits;
  }

  get remaining(): number {
    this.ensureCurrentDay();
    return Math.max(0, this.softLimit - this.usedUnits);
  }

  get limit(): number {
    return this.softLimit;
  }
}
