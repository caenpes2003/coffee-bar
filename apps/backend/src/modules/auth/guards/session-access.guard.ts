import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { TableSessionStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

/**
 * Ensures a session-scoped customer request targets *its own* session.
 *
 * - admin tokens bypass this guard (staff can read/act on any session).
 * - session tokens must match `sessionId` (from route param or body).
 * - table tokens are rejected here; they cannot read session-scoped data.
 *
 * Además (F3 — revocación server-side): para tokens de sesión valida
 * contra la BD que:
 *   1. La TableSession siga ABIERTA — cerrar la mesa desde el admin
 *      revoca de inmediato a los clientes (403 SESSION_REVOKED). Antes
 *      el token firmado seguía sirviendo hasta su `exp`.
 *   2. El claim `acg` (epoch del código del bar al emitir el token)
 *      coincida con el epoch vigente — la rotación MANUAL del código
 *      incrementa el epoch y revoca todo (403 ACCESS_CODE_ROTATED).
 *      La rotación automática de 24h NO cambia el epoch. Tokens sin
 *      `acg` (pre-deploy) se aceptan hasta que expiren solos.
 *
 * Cache en memoria con TTL corto para no pegar 2 queries en cada
 * request del cliente (bill + pedidos + polling): la revocación tarda
 * a lo sumo CACHE_TTL_MS en propagar, y el cierre de mesa además emite
 * `table-session:closed` por socket, que limpia al cliente al instante.
 *
 * Expects the route to expose a session id at one of:
 *   req.params.sessionId
 *   req.params.id           (when the controller mounts under /bill/:id etc.)
 *   req.body.table_session_id
 *   req.query.table_session_id
 */
const CACHE_TTL_MS = 10_000;

type SessionCacheEntry = {
  open: boolean;
  at: number;
};

@Injectable()
export class SessionAccessGuard implements CanActivate {
  private readonly sessionCache = new Map<number, SessionCacheEntry>();
  private epochCache: { value: number; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) {
      throw new ForbiddenException({
        message: "Missing auth payload",
        code: "AUTH_MISSING",
      });
    }
    if (auth.kind === "admin") return true;
    if (auth.kind !== "session") {
      throw new ForbiddenException({
        message: "Session token required",
        code: "AUTH_SESSION_REQUIRED",
      });
    }

    const targetId = this.extractSessionId(req);
    if (targetId == null) {
      // No session id on the request — deny rather than allow-by-default.
      throw new ForbiddenException({
        message: "No session scope on request",
        code: "AUTH_NO_SESSION_SCOPE",
      });
    }
    if (targetId !== auth.session_id) {
      throw new ForbiddenException({
        message: "Cross-session access denied",
        code: "AUTH_CROSS_SESSION",
      });
    }

    // Revocación 1: la sesión debe seguir abierta en BD.
    const open = await this.isSessionOpen(auth.session_id);
    if (!open) {
      throw new ForbiddenException({
        message: "La cuenta fue cerrada por el bar",
        code: "SESSION_REVOKED",
      });
    }

    // Revocación 2: el epoch del código debe seguir vigente. Tokens
    // viejos sin claim `acg` pasan (retrocompat de deploy).
    if (auth.acg !== undefined) {
      const currentEpoch = await this.getCurrentEpoch();
      if (auth.acg !== currentEpoch) {
        throw new ForbiddenException({
          message: "El código del bar cambió — vuelve a ingresar",
          code: "ACCESS_CODE_ROTATED",
        });
      }
    }

    return true;
  }

  private async isSessionOpen(sessionId: number): Promise<boolean> {
    const cached = this.sessionCache.get(sessionId);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.open;
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    const open =
      session != null && session.status !== TableSessionStatus.closed;
    this.sessionCache.set(sessionId, { open, at: now });
    // Poda perezosa: el map no debe crecer sin límite en un proceso
    // de meses. Con pocas mesas nunca pasa de decenas de entradas.
    if (this.sessionCache.size > 500) {
      for (const [id, entry] of this.sessionCache) {
        if (now - entry.at >= CACHE_TTL_MS) this.sessionCache.delete(id);
      }
    }
    return open;
  }

  private async getCurrentEpoch(): Promise<number> {
    const now = Date.now();
    if (this.epochCache && now - this.epochCache.at < CACHE_TTL_MS) {
      return this.epochCache.value;
    }
    const latest = await this.prisma.barAccessCode.findFirst({
      orderBy: { created_at: "desc" },
      select: { epoch: true },
    });
    const value = latest?.epoch ?? 0;
    this.epochCache = { value, at: now };
    return value;
  }

  private extractSessionId(req: Request): number | null {
    const params = req.params as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;

    const candidates: unknown[] = [
      params.sessionId,
      params.id,
      body.table_session_id,
      query.table_session_id,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }
}
