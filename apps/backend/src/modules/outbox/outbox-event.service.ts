import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { OutboxStatus, Prisma } from "@prisma/client";
import { OutboxConfigService } from "./outbox-config.service";
import type {
  EnqueueOutboxEventInput,
  EnqueueOutboxEventResult,
} from "./outbox-event.types";
import { validatePayload } from "./schemas/outbox-event-registry";

/**
 * OutboxEventService — escribe filas en `OutboxEvent` dentro de la
 * misma transacción que la entidad afectada. Es la pieza fundacional
 * del Transactional Outbox pattern.
 *
 * Ver ARQUITECTURA.md §4. Reglas que el service garantiza:
 *
 *   1. Atomicidad: `enqueue(tx, ...)` SIEMPRE recibe un Prisma
 *      transaction client. No existe variante "estándalon". Esto
 *      previene el bug clásico "entidad commiteada pero evento
 *      perdido" (o viceversa).
 *
 *   2. Validación: el payload se valida contra el schema registrado
 *      para su `event_type`. Si el event_type no está registrado o el
 *      payload no cumple su shape, throw `BadRequestException`. La
 *      transacción del caller hace rollback — la entidad nunca se
 *      escribe sin su evento válido.
 *
 *   3. Idempotency_key: se genera en el insert (default uuid()) por
 *      Prisma. Garantiza que el cloud puede deduplicar reintentos del
 *      worker sin importar la fila que se haya pushea-do antes.
 *
 *   4. Versionado: cada evento lleva snapshot de `schema_version` y
 *      `app_version` desde OutboxConfigService. El cloud usa esto para
 *      decidir si aplicar/quarantine/rechazar (ver §4 idempotencia +
 *      §4 schema versioning).
 *
 * Esta primera versión NO incluye worker ni push al cloud. Solo escribe
 * en la tabla; el worker es un commit posterior.
 */
@Injectable()
export class OutboxEventService {
  private readonly logger = new Logger(OutboxEventService.name);

  constructor(private readonly config: OutboxConfigService) {}

  /**
   * Encolar un evento dentro de una transacción.
   *
   * Tx es obligatorio por contrato: forzar al caller a tener una
   * transacción abierta es lo que garantiza la atomicidad
   * entidad+evento. Si el caller no necesita transacción para la
   * entidad (caso raro), igualmente debe crear una sola para el
   * enqueue — el costo es despreciable y la disciplina del modelo se
   * mantiene.
   *
   * Errores posibles:
   *   - 400 OUTBOX_VALIDATION_FAILED: payload no cumple el schema o
   *     event_type no está registrado. Rollback de la transacción.
   *   - 400 OUTBOX_INVALID_AGGREGATE_ID: aggregate_id no es UUID.
   *
   * @returns El id (BigInt) del evento creado y su idempotency_key.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: EnqueueOutboxEventInput,
  ): Promise<EnqueueOutboxEventResult> {
    // Validación de campos top-level del input.
    if (!input.event_type?.trim()) {
      throw new BadRequestException({
        message: "event_type is required",
        code: "OUTBOX_VALIDATION_FAILED",
      });
    }
    if (!input.aggregate_type?.trim()) {
      throw new BadRequestException({
        message: "aggregate_type is required",
        code: "OUTBOX_VALIDATION_FAILED",
      });
    }
    if (!this.isUuid(input.aggregate_id)) {
      throw new BadRequestException({
        message: `aggregate_id must be a UUID (got "${input.aggregate_id}")`,
        code: "OUTBOX_INVALID_AGGREGATE_ID",
      });
    }

    // Validación del payload contra el schema del registry.
    const payloadErrors = validatePayload(input.event_type, input.payload);
    if (payloadErrors.length > 0) {
      throw new BadRequestException({
        message: `Invalid payload for event_type "${input.event_type}": ${payloadErrors.join("; ")}`,
        code: "OUTBOX_VALIDATION_FAILED",
        errors: payloadErrors,
      });
    }

    // Insert dentro de la transacción del caller. El idempotency_key
    // lo genera Prisma con @default(uuid()) del schema — no lo seteamos
    // acá para mantener una única fuente de verdad.
    const event = await tx.outboxEvent.create({
      data: {
        node_id: this.config.nodeId,
        event_type: input.event_type,
        aggregate_type: input.aggregate_type,
        aggregate_id: input.aggregate_id,
        payload: input.payload as Prisma.InputJsonValue,
        schema_version: this.config.schemaVersion,
        app_version: this.config.appVersion,
        status: OutboxStatus.pending,
      },
      select: {
        id: true,
        idempotency_key: true,
      },
    });

    return {
      id: event.id,
      idempotency_key: event.idempotency_key,
    };
  }

  private isUuid(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v,
    );
  }
}
