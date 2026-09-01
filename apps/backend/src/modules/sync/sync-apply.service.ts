import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { InboxStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { MissingParentError, SYNC_APPLIERS } from "./sync-appliers";

/**
 * Eventos snapshot: el payload es el estado COMPLETO del aggregate, y
 * el último aplicado gana. Si uno intermedio choca con un unique
 * parcial ("solo una sesión activa por mesa", "solo una jornada
 * abierta") pero YA hay un evento más nuevo del mismo aggregate en la
 * cola, el intermedio se marca `applied` como superseded — el estado
 * final lo pone el más nuevo. Caso típico: replay de backlog donde una
 * sesión vieja pasa por su estado `open` transitorio que hoy colisiona.
 */
const SNAPSHOT_EVENT_TYPES = new Set([
  "session.opened",
  "session.marked_paid",
  "session.closed",
  "session.voided",
  "session.transferred",
  "cash_register.opened",
  "cash_register.closed",
]);

/**
 * Aplicador del inbox (Fase 2 — corre donde el ingest está activo,
 * o sea el cloud): toma InboxEvent `received` en orden de llegada y
 * los materializa en las tablas del backoffice vía SYNC_APPLIERS.
 *
 * Cada evento se aplica en su propia transacción:
 *   - OK → `applied` + applied_at.
 *   - Padre aún no aplicado (MissingParentError) → sigue `received`
 *     con backoff corto; el orden de emisión hace que el padre llegue
 *     enseguida (cubre lotes con fallas parciales y reordenamientos).
 *   - Error de datos/schema → backoff, y tras MAX_ATTEMPTS pasa a
 *     `quarantined` con last_error — nunca descartar silenciosamente
 *     (§4 de ARQUITECTURA). Se reprocesa a mano tras corregir.
 */
const POLL_MS = Number(process.env.SYNC_APPLY_POLL_MS ?? 2_000);
const BATCH_SIZE = Number(process.env.SYNC_APPLY_BATCH_SIZE ?? 100);
const MAX_ATTEMPTS = 20;
// Backoff corto: el caso dominante es "padre en el próximo lote".
const BACKOFF_SECONDS = [2, 5, 15, 60, 300];

@Injectable()
export class SyncApplyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncApplyService.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Mismo interruptor que el ingest: solo el nodo receptor (cloud)
    // tiene SYNC_INGEST_KEY. Un local jamás aplica inbox (no recibe).
    if (!process.env.SYNC_INGEST_KEY) {
      this.logger.log(
        "SYNC_INGEST_KEY no configurada — applier de inbox apagado (este nodo no recibe sync).",
      );
      return;
    }
    this.logger.log(
      `Applier de inbox activo: materializando eventos cada ${POLL_MS}ms (lotes de ${BATCH_SIZE}).`,
    );
    this.interval = setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const now = new Date();
        const batch = await this.prisma.inboxEvent.findMany({
          where: {
            status: InboxStatus.received,
            OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }],
          },
          // Orden de llegada (id) ≈ orden de emisión por nodo — el
          // drain del emisor envía en occurred_at ASC.
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        });
        if (batch.length === 0) break;
        let applied = 0;
        for (const event of batch) {
          const ok = await this.applyOne(event.id);
          if (ok) applied += 1;
        }
        if (applied > 0) {
          this.logger.log(`Apply: ${applied}/${batch.length} evento(s) → applied`);
        }
        if (batch.length < BATCH_SIZE) break;
      }
    } catch (err) {
      this.logger.error(
        `Tick de apply falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Aplica UN evento en su propia tx. @returns true si quedó applied. */
  private async applyOne(eventId: bigint): Promise<boolean> {
    const event = await this.prisma.inboxEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || event.status !== InboxStatus.received) return false;

    const applier = SYNC_APPLIERS[event.event_type];
    if (!applier) {
      // event_type sin applier: cuarentena inmediata con mensaje claro
      // (el registry del emisor y este mapa deben ir a la par).
      await this.prisma.inboxEvent.update({
        where: { id: eventId },
        data: {
          status: InboxStatus.quarantined,
          last_error: `no applier for event_type ${event.event_type}`,
        },
      });
      this.logger.error(
        `⚠ Evento ${event.event_type} sin applier → quarantined (id=${eventId})`,
      );
      return false;
    }

    // Guardia anti-regresión para snapshots: si ya se aplicó un evento
    // MÁS NUEVO (occurred_at mayor) del mismo aggregate, aplicar este
    // pisaría el estado final con uno viejo. Se marca applied como
    // stale sin tocar datos. Cubre desorden real de llegada (lotes con
    // fallas parciales, reintentos cruzados), no solo replay.
    if (SNAPSHOT_EVENT_TYPES.has(event.event_type)) {
      const newerApplied = await this.prisma.inboxEvent.findFirst({
        where: {
          node_id: event.node_id,
          aggregate_id: event.aggregate_id,
          status: InboxStatus.applied,
          occurred_at: { gt: event.occurred_at },
        },
        select: { id: true },
      });
      if (newerApplied) {
        await this.prisma.inboxEvent.update({
          where: { id: eventId },
          data: {
            status: InboxStatus.applied,
            applied_at: new Date(),
            last_error:
              "stale: ya se aplicó un snapshot más nuevo del mismo aggregate — este no toca datos",
            next_attempt_at: null,
          },
        });
        return true;
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await applier(tx, event.payload as Record<string, unknown>);
        await tx.inboxEvent.update({
          where: { id: eventId },
          data: {
            status: InboxStatus.applied,
            applied_at: new Date(),
            last_error: null,
            next_attempt_at: null,
          },
        });
      });
      return true;
    } catch (err) {
      // Conflicto de unique en un snapshot con un evento MÁS NUEVO del
      // mismo aggregate en cola → superseded (ver SNAPSHOT_EVENT_TYPES).
      const isUniqueConflict =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (isUniqueConflict && SNAPSHOT_EVENT_TYPES.has(event.event_type)) {
        const newer = await this.prisma.inboxEvent.findFirst({
          where: {
            node_id: event.node_id,
            aggregate_id: event.aggregate_id,
            id: { gt: event.id },
          },
          select: { id: true },
        });
        if (newer) {
          await this.prisma.inboxEvent.update({
            where: { id: eventId },
            data: {
              status: InboxStatus.applied,
              applied_at: new Date(),
              last_error:
                "superseded: snapshot intermedio en conflicto de unique; el estado final lo aplica un evento posterior del mismo aggregate",
              next_attempt_at: null,
            },
          });
          return true;
        }
      }
      const isMissingParent = err instanceof MissingParentError;
      const message = err instanceof Error ? err.message : String(err);
      const attempts = event.apply_attempts + 1;
      const backoffSec =
        BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
      // MissingParent es esperable (padre en el próximo lote) y no
      // cuenta tan fuerte; los demás errores agotan intentos normal.
      const quarantine = !isMissingParent && attempts >= MAX_ATTEMPTS;
      await this.prisma.inboxEvent.update({
        where: { id: eventId },
        data: {
          apply_attempts: { increment: 1 },
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + backoffSec * 1000),
          ...(quarantine ? { status: InboxStatus.quarantined } : {}),
        },
      });
      if (quarantine) {
        this.logger.error(
          `⚠ Evento ${event.event_type} (id=${eventId}) EN CUARENTENA tras ${attempts} intentos: ${message}`,
        );
      }
      return false;
    }
  }
}
