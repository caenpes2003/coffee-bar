import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  TableOpenRequest,
  TableOpenRequestStatus,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AccessCodeService } from "../access-code/access-code.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { TokenService } from "../auth/token.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableSessionsService } from "../table-sessions/table-sessions.service";

type SerializedTableSession = ReturnType<TableSessionsService["serialize"]>;

/** Ventana de vida de una solicitud pending. Corta a propósito: el
 *  cliente está parado frente a la mesa esperando — si el staff no
 *  respondió en 2 minutos, mejor expirar y que reintente. */
const REQUEST_TTL_MS = 2 * 60 * 1000;

export type Actor = { user_id: number; name: string };

export type CreateResult =
  | {
      mode: "joined";
      session: SerializedTableSession;
      session_token: string;
    }
  | {
      mode: "pending";
      request_id: number;
      claim_token: string;
      expires_at: string;
    };

export type ClaimResult =
  | { status: "pending" }
  | { status: "rejected" | "expired" | "cancelled" }
  | {
      status: "approved";
      session: SerializedTableSession;
      session_token: string;
    };

/**
 * Flujo de apertura de mesa con aprobación (F3).
 *
 * Cliente con TABLE token + código del bar VÁLIDO (server-side):
 *   - Mesa ya abierta → se une de una: session_token inmediato (regla
 *     del dueño: unirse a mesa abierta solo exige el código).
 *   - Mesa cerrada → TableOpenRequest pending → modal en el admin →
 *     approve crea la sesión / reject la niega. El dispositivo (aún
 *     anónimo) reclama el resultado con su `claim_token` por HTTP,
 *     UNA sola vez — el session_token jamás viaja por socket.
 */
@Injectable()
export class TableOpenRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessCodes: AccessCodeService,
    private readonly sessions: TableSessionsService,
    private readonly tokens: TokenService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditLogService,
  ) {}

  async create(tableId: number, accessCode: string): Promise<CreateResult> {
    const codeOk = await this.accessCodes.validate(accessCode);
    if (!codeOk) {
      throw new ForbiddenException({
        message: "Código incorrecto",
        code: "ACCESS_CODE_INVALID",
      });
    }

    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, number: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    // Mesa ya abierta (por el admin o por otro cliente): unirse. La
    // presencia física la garantiza el código; no molesta al admin.
    const current = await this.sessions.getCurrentForTable(tableId);
    if (current && current.status !== TableSessionStatus.closed) {
      return {
        mode: "joined",
        session: this.sessions.serialize(current),
        session_token: await this.signSessionToken(current.id, tableId),
      };
    }

    // Mesa cerrada → solicitud pending para el admin.
    await this.expireStale();
    const existing = await this.prisma.tableOpenRequest.findFirst({
      where: {
        table_id: tableId,
        status: TableOpenRequestStatus.pending,
        expires_at: { gt: new Date() },
      },
    });
    if (existing) {
      // Otro dispositivo (o un retry sin claim_token) ya tiene una
      // pendiente. No duplicamos — el 409 lleva la expiración para que
      // la UI muestre "ya hay una solicitud en curso".
      throw new ConflictException({
        message: "Ya hay una solicitud de apertura pendiente para esta mesa",
        code: "TABLE_OPEN_REQUEST_PENDING",
        expires_at: existing.expires_at.toISOString(),
      });
    }

    const request = await this.prisma.tableOpenRequest.create({
      data: {
        table_id: tableId,
        expires_at: new Date(Date.now() + REQUEST_TTL_MS),
      },
    });
    void this.audit.record({
      kind: "table_open_requested",
      table_id: tableId,
      table_number: table.number,
      request_id: request.id,
    });
    this.realtime.emitTableOpenRequestCreated({
      id: request.id,
      table_id: tableId,
      table_number: table.number,
      created_at: request.created_at.toISOString(),
      expires_at: request.expires_at.toISOString(),
    });
    return {
      mode: "pending",
      request_id: request.id,
      claim_token: request.claim_token,
      expires_at: request.expires_at.toISOString(),
    };
  }

  /**
   * El dispositivo reclama el resultado con su claim_token (la única
   * credencial que tiene mientras espera). El session_token de una
   * solicitud aprobada se entrega UNA sola vez — reclamos posteriores
   * reciben 410 para que un token filtrado del historial no sirva.
   */
  async claim(claimToken: string): Promise<ClaimResult> {
    const request = await this.prisma.tableOpenRequest.findUnique({
      where: { claim_token: claimToken },
    });
    if (!request) {
      throw new NotFoundException({
        message: "Solicitud no encontrada",
        code: "TABLE_OPEN_REQUEST_NOT_FOUND",
      });
    }

    if (request.status === TableOpenRequestStatus.pending) {
      if (request.expires_at <= new Date()) {
        await this.prisma.tableOpenRequest.updateMany({
          where: { id: request.id, status: TableOpenRequestStatus.pending },
          data: {
            status: TableOpenRequestStatus.expired,
            resolved_at: new Date(),
          },
        });
        return { status: "expired" };
      }
      return { status: "pending" };
    }

    if (request.status !== TableOpenRequestStatus.approved) {
      return {
        status: request.status as "rejected" | "expired" | "cancelled",
      };
    }

    // Aprobada: entrega única. updateMany con guard claimed_at IS NULL
    // — dos reclamos concurrentes se serializan y solo uno recibe el
    // token.
    const claimed = await this.prisma.tableOpenRequest.updateMany({
      where: { id: request.id, claimed_at: null },
      data: { claimed_at: new Date() },
    });
    if (claimed.count === 0) {
      throw new GoneException({
        message: "El resultado ya fue reclamado",
        code: "TABLE_OPEN_REQUEST_CLAIMED",
      });
    }
    const session = request.session_id
      ? await this.prisma.tableSession.findUnique({
          where: { id: request.session_id },
        })
      : null;
    if (!session || session.status === TableSessionStatus.closed) {
      // La sesión se cerró entre approve y claim (raro pero posible).
      return { status: "expired" };
    }
    return {
      status: "approved",
      session: this.sessions.serialize(session),
      session_token: await this.signSessionToken(session.id, session.table_id),
    };
  }

  async approve(
    requestId: number,
    actor: Actor,
  ): Promise<{ ok: true; session_id: number }> {
    // Guard de concurrencia: solo UNA transición pending→approved gana
    // (doble click del admin, dos pestañas, o carrera con expiración).
    const marked = await this.prisma.tableOpenRequest.updateMany({
      where: {
        id: requestId,
        status: TableOpenRequestStatus.pending,
        expires_at: { gt: new Date() },
      },
      data: {
        status: TableOpenRequestStatus.approved,
        resolved_by: actor.name,
        resolved_at: new Date(),
      },
    });
    if (marked.count === 0) {
      throw new ConflictException({
        message: "La solicitud ya no está pendiente (resuelta o expirada)",
        code: "TABLE_OPEN_REQUEST_NOT_PENDING",
      });
    }
    const request = await this.prisma.tableOpenRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { table: { select: { number: true } } },
    });

    let session;
    try {
      // Reutiliza el open() existente (join-or-create + outbox +
      // projection + sockets de sesión).
      session = await this.sessions.open(request.table_id, {
        openedBy: "customer",
      });
    } catch (err) {
      // Si abrir falló (ej. caja cerrada entre medio), devolvemos la
      // solicitud a pending para que el admin pueda reintentar dentro
      // de la ventana.
      await this.prisma.tableOpenRequest.update({
        where: { id: requestId },
        data: {
          status: TableOpenRequestStatus.pending,
          resolved_by: null,
          resolved_at: null,
        },
      });
      throw err;
    }
    await this.prisma.tableOpenRequest.update({
      where: { id: requestId },
      data: { session_id: session.id },
    });
    void this.audit.record({
      kind: "session_open_approved",
      actor_id: actor.user_id,
      actor_label: actor.name,
      table_id: request.table_id,
      table_number: request.table.number,
      session_id: session.id,
      request_id: requestId,
    });
    this.realtime.emitTableOpenRequestResolved(request.table_id, {
      id: requestId,
      table_id: request.table_id,
      table_number: request.table.number,
      status: "approved",
    });
    return { ok: true, session_id: session.id };
  }

  async reject(requestId: number, actor: Actor): Promise<{ ok: true }> {
    const marked = await this.prisma.tableOpenRequest.updateMany({
      where: { id: requestId, status: TableOpenRequestStatus.pending },
      data: {
        status: TableOpenRequestStatus.rejected,
        resolved_by: actor.name,
        resolved_at: new Date(),
      },
    });
    if (marked.count === 0) {
      throw new ConflictException({
        message: "La solicitud ya no está pendiente",
        code: "TABLE_OPEN_REQUEST_NOT_PENDING",
      });
    }
    const request = await this.prisma.tableOpenRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { table: { select: { number: true } } },
    });
    void this.audit.record({
      kind: "session_open_rejected",
      actor_id: actor.user_id,
      actor_label: actor.name,
      table_id: request.table_id,
      table_number: request.table.number,
      request_id: requestId,
    });
    this.realtime.emitTableOpenRequestResolved(request.table_id, {
      id: requestId,
      table_id: request.table_id,
      table_number: request.table.number,
      status: "rejected",
    });
    return { ok: true };
  }

  /** Pendientes vigentes para hidratar el modal admin al recargar. */
  async listPending(): Promise<
    Array<{
      id: number;
      table_id: number;
      table_number: number;
      created_at: string;
      expires_at: string;
    }>
  > {
    await this.expireStale();
    const rows = await this.prisma.tableOpenRequest.findMany({
      where: {
        status: TableOpenRequestStatus.pending,
        expires_at: { gt: new Date() },
      },
      include: { table: { select: { number: true } } },
      orderBy: { created_at: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      table_id: r.table_id,
      table_number: r.table.number,
      created_at: r.created_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
    }));
  }

  /** Housekeeping perezoso: pendientes vencidas pasan a expired. */
  private async expireStale(): Promise<void> {
    await this.prisma.tableOpenRequest.updateMany({
      where: {
        status: TableOpenRequestStatus.pending,
        expires_at: { lte: new Date() },
      },
      data: {
        status: TableOpenRequestStatus.expired,
        resolved_at: new Date(),
      },
    });
  }

  /**
   * Firma el session token estampando el epoch vigente del código
   * (`acg`) — así la rotación manual del código revoca este token.
   */
  private async signSessionToken(
    sessionId: number,
    tableId: number,
  ): Promise<string> {
    const acg = await this.accessCodes.getCurrentEpoch();
    return this.tokens.signSession({
      session_id: sessionId,
      table_id: tableId,
      acg,
    });
  }
}

// Re-export del tipo para el controller sin acoplarlo al service de
// sesiones directamente.
export type { TableOpenRequest };
