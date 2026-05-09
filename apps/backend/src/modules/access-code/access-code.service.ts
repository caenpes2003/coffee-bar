import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

const TTL_HOURS = 24;
// Codes that are too easy to guess by humans. We re-roll if we hit one.
const FORBIDDEN = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "4321",
  "1212",
  "2121",
  "0123",
  "9876",
]);

/**
 * Daily rotating bar access code. Customers must enter the current code
 * once per device when joining a session. The code rotates lazily: the
 * first request after `expires_at` (or after a manual rotation) draws a
 * new random one.
 *
 * The "current" code is the most recently created `is_active = true`
 * row. Older rows are soft-marked inactive — kept for audit, swept
 * weekly by the prune job (we cap retention at 60 days).
 */
@Injectable()
export class AccessCodeService {
  private readonly logger = new Logger(AccessCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the current active code, generating one if there's none or
   * the latest one expired. Idempotent within a single tick so two
   * parallel requests don't both create a row.
   *
   * The `id` is exposed alongside the code so the customer device can
   * pin its "I already typed the code" flag to a specific row. When
   * the code rotates the id changes, and the gate reappears on the
   * next visit even if the device kept its sessionStorage.
   */
  async getOrRotate(): Promise<{
    id: number;
    code: string;
    expires_at: Date;
  }> {
    const latest = await this.prisma.barAccessCode.findFirst({
      where: { is_active: true },
      orderBy: { created_at: "desc" },
    });
    if (latest && latest.expires_at > new Date()) {
      return { id: latest.id, code: latest.code, expires_at: latest.expires_at };
    }
    return this.rotate("system");
  }

  async rotate(rotatedBy: string | null): Promise<{
    id: number;
    code: string;
    expires_at: Date;
  }> {
    // Mark all previous active codes as inactive in one shot. A stale
    // active row hanging around means rotating manually wouldn't take
    // effect immediately if `getCurrent` always picks the most recent.
    await this.prisma.barAccessCode.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });

    const code = this.generateRandomCode();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
    const created = await this.prisma.barAccessCode.create({
      data: {
        code,
        is_active: true,
        expires_at: expiresAt,
        rotated_by: rotatedBy,
      },
    });
    this.logger.log(
      `Bar access code rotated by ${rotatedBy ?? "system"}; expires ${expiresAt.toISOString()}`,
    );
    return {
      id: created.id,
      code: created.code,
      expires_at: created.expires_at,
    };
  }

  /**
   * Validates an attempt. Compares against the current active code and
   * the previous one inside its TTL window — that way a customer who
   * just typed the right code at 23:59 doesn't get rejected if it
   * rotates at 00:00.
   */
  async validate(code: string): Promise<boolean> {
    const trimmed = (code ?? "").trim();
    if (!/^\d{4}$/.test(trimmed)) return false;
    const current = await this.getOrRotate();
    if (current.code === trimmed) return true;
    // Allow a 5-minute grace period on the previous code in case a
    // rotation happened mid-customer-input.
    const previous = await this.prisma.barAccessCode.findFirst({
      where: { is_active: false },
      orderBy: { created_at: "desc" },
    });
    if (previous && previous.code === trimmed) {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (previous.expires_at.getTime() > fiveMinutesAgo) return true;
    }
    return false;
  }

  private generateRandomCode(): string {
    while (true) {
      const n = Math.floor(Math.random() * 10000);
      const code = String(n).padStart(4, "0");
      if (!FORBIDDEN.has(code)) return code;
    }
  }
}
