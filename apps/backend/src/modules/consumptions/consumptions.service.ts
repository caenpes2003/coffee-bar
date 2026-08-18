import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Consumption,
  ConsumptionType,
  PaymentMethod,
  Prisma,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CashRegisterService } from "../cash-register/cash-register.service";
import { OutboxEventService } from "../outbox/outbox-event.service";
import { PaymentsService } from "../payments/payments.service";
import { ProductsService } from "../products/products.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";
import {
  AdjustmentKind,
  CreateAdjustmentDto,
} from "./dto/create-adjustment.dto";
import { serializeConsumptionForOutbox } from "./outbox-payload";
import { RefundConsumptionDto } from "./dto/refund-consumption.dto";

/**
 * The authenticated staff/admin acting on the ledger. When provided, the
 * service ignores any `created_by` sent in the DTO: the body is never trusted
 * as a source of audit truth once there is a user behind the token.
 */
export type AuditActor = {
  user_id: number;
  name: string;
} | null;

const CONSUMPTION_INCLUDE = {
  order: { select: { id: true, status: true } },
  reverses: { select: { id: true, description: true, amount: true, type: true } },
} satisfies Prisma.ConsumptionInclude;

type ConsumptionFull = Prisma.ConsumptionGetPayload<{
  include: typeof CONSUMPTION_INCLUDE;
}>;

export type BillSummary = {
  subtotal: number;
  discounts_total: number;
  adjustments_total: number;
  // Sum of negative `partial_payment` rows. Stored as a negative
  // number so the UI can show "Pagado parcial: -$50.000" without
  // needing to invert the sign on read.
  partial_payments_total: number;
  total: number;
  item_count: number;
};

export type BillView = {
  session_id: number;
  table_id: number;
  status: TableSessionStatus;
  opened_at: Date;
  closed_at: Date | null;
  last_consumption_at: Date | null;
  summary: BillSummary;
  items: ReturnType<ConsumptionsService["serialize"]>[];
};

// Composición real de un compuesto vendido (qué salió físicamente),
// reconstruida desde OrderItemComponent. `product_id` del componente
// viaja además del nombre porque el admin lo necesita para repetir la
// línea con la misma composición (armar el payload units del quickAdd).
export type BillLineComponent = {
  product_id: number;
  name: string;
  quantity: number;
};
export type BillLineUnit = {
  unit_index: number;
  components: BillLineComponent[];
};

// Vista de una asignación viva colgada de una línea partial_payment:
// qué producto cubre, cuántas unidades y por cuánto.
export type BillAllocationView = {
  product_consumption_id: number;
  description: string;
  quantity: number;
  amount: number;
};

// Datos batch opcionales para enriquecer la serialización de las
// líneas del BillView. Cada mapa se calcula UNA vez por cuenta.
type BillSerializeExtras = {
  compositions?: Map<string, BillLineUnit[]>;
  // Consumption(type=product).id → unidades cubiertas por pagos
  // parciales vivos.
  paidByProduct?: Map<number, number>;
  // Consumption(type=partial_payment).id → sus asignaciones.
  allocationsByPayment?: Map<number, BillAllocationView[]>;
};

@Injectable()
export class ConsumptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
    private readonly products: ProductsService,
    private readonly outbox: OutboxEventService,
    private readonly payments: PaymentsService,
    private readonly cashRegister: CashRegisterService,
  ) {}

  async getBill(sessionId: number): Promise<BillView> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        table_id: true,
        status: true,
        opened_at: true,
        closed_at: true,
        last_consumption_at: true,
      },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }

    const items = await this.prisma.consumption.findMany({
      where: { table_session_id: sessionId },
      include: CONSUMPTION_INCLUDE,
      orderBy: { created_at: "asc" },
    });

    const [compositions, allocationMaps] = await Promise.all([
      this.loadCompositionsForConsumptions(items),
      this.loadAllocationsForSession(sessionId),
    ]);
    const extras: BillSerializeExtras = {
      compositions,
      ...allocationMaps,
    };

    return {
      session_id: session.id,
      table_id: session.table_id,
      status: session.status,
      opened_at: session.opened_at,
      closed_at: session.closed_at,
      last_consumption_at: session.last_consumption_at,
      summary: this.summarize(items),
      items: items.map((c) => this.serialize(c, extras)),
    };
  }

  /**
   * Asignaciones VIVAS de pagos parciales de la sesión (las de pagos
   * reversados no cuentan — regla de vida del modelo). Una sola query;
   * de ella salen los dos mapas que consume la serialización:
   * "cuánto de cada línea de producto ya está pagado" y "qué cubre
   * cada pago parcial".
   */
  private async loadAllocationsForSession(sessionId: number): Promise<{
    paidByProduct: Map<number, number>;
    allocationsByPayment: Map<number, BillAllocationView[]>;
  }> {
    const rows = await this.prisma.partialPaymentAllocation.findMany({
      where: {
        payment_consumption: {
          table_session_id: sessionId,
          reversed_at: null,
        },
      },
      select: {
        payment_consumption_id: true,
        product_consumption_id: true,
        quantity: true,
        amount: true,
        product_consumption: { select: { description: true } },
      },
      orderBy: { id: "asc" },
    });

    const paidByProduct = new Map<number, number>();
    const allocationsByPayment = new Map<number, BillAllocationView[]>();
    for (const r of rows) {
      paidByProduct.set(
        r.product_consumption_id,
        (paidByProduct.get(r.product_consumption_id) ?? 0) + r.quantity,
      );
      const list = allocationsByPayment.get(r.payment_consumption_id) ?? [];
      list.push({
        product_consumption_id: r.product_consumption_id,
        description: r.product_consumption.description,
        quantity: r.quantity,
        amount: Number(r.amount),
      });
      allocationsByPayment.set(r.payment_consumption_id, list);
    }
    return { paidByProduct, allocationsByPayment };
  }

  /**
   * Composición real de las líneas de producto de la cuenta,
   * reconstruida desde OrderItemComponent — mismo patrón batch que el
   * ticket de sesiones cerradas (sales-insights): una sola query por
   * los order_ids presentes, mapeada por `${order_id}:${product_id}`
   * (clave única gracias a la invariante "un OrderItem por
   * (order_id, product_id)" que protege normalizeItems).
   *
   * El Consumption no guarda la mezcla (description es solo el nombre
   * del producto); esta es la única fuente de verdad de qué botellas/
   * latas salieron en cada cubetazo, y la cuenta viva la necesita para
   * que "Cubetazo Mix" no se vea idéntico con 4+2 que con 3+3.
   */
  private async loadCompositionsForConsumptions(
    items: Array<Pick<Consumption, "order_id" | "type">>,
  ): Promise<Map<string, BillLineUnit[]>> {
    const orderIds = new Set<number>();
    for (const c of items) {
      if (c.type === ConsumptionType.product && c.order_id != null) {
        orderIds.add(c.order_id);
      }
    }
    const map = new Map<string, BillLineUnit[]>();
    if (orderIds.size === 0) return map;

    const orderItems = await this.prisma.orderItem.findMany({
      where: { order_id: { in: Array.from(orderIds) } },
      select: {
        order_id: true,
        product_id: true,
        components: {
          select: {
            unit_index: true,
            quantity: true,
            component_product_id: true,
            component_product: { select: { name: true } },
          },
          orderBy: { unit_index: "asc" },
        },
      },
    });

    for (const oi of orderItems) {
      if (oi.components.length === 0) continue;
      const byUnit = new Map<number, BillLineComponent[]>();
      for (const c of oi.components) {
        const arr = byUnit.get(c.unit_index) ?? [];
        arr.push({
          product_id: c.component_product_id,
          name: c.component_product.name,
          quantity: c.quantity,
        });
        byUnit.set(c.unit_index, arr);
      }
      const units: BillLineUnit[] = Array.from(byUnit.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([unit_index, components]) => ({ unit_index, components }));
      map.set(`${oi.order_id}:${oi.product_id}`, units);
    }
    return map;
  }

  async createAdjustment(
    sessionId: number,
    dto: CreateAdjustmentDto,
    actor: AuditActor = null,
  ): Promise<ConsumptionFull> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; adjustments are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    // Sign rules:
    //   discount -> always negative (server forces sign if client sent positive).
    //   adjustment -> free ± sign.
    let amount = dto.amount;
    if (dto.type === AdjustmentKind.discount && amount > 0) {
      amount = -amount;
    }
    if (dto.type === AdjustmentKind.discount && amount >= 0) {
      throw new BadRequestException({
        message: "Discount amount must be non-zero",
        code: "DISCOUNT_INVALID_AMOUNT",
      });
    }

    const type =
      dto.type === AdjustmentKind.discount
        ? ConsumptionType.discount
        : ConsumptionType.adjustment;
    const description = this.describeAdjustment(type, dto.reason);

    const result = await this.prisma.$transaction(async (tx) => {
      const cashSession = await this.cashRegister.requireOpen(tx);
      const created = await tx.consumption.create({
        data: {
          table_session_id: sessionId,
          description,
          quantity: 1,
          unit_amount: amount,
          amount,
          type,
          cash_register_session_id: cashSession.id,
          reason: dto.reason,
          notes: dto.notes ?? null,
          // Audit rule: server is the single source of truth. The DTO does
          // not even expose `created_by` anymore (Phase G7) — only an
          // authenticated actor can stamp it. Internal callers (seeds,
          // scripts) write null, which is the honest answer.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });
      // Encolar evento dentro de la MISMA transacción. Si el enqueue
      // falla (event_type/payload inválido), la transacción revierte y
      // el Consumption no queda creado — invariante del outbox.
      await this.outbox.enqueue(tx, {
        event_type: "consumption.created",
        aggregate_type: "Consumption",
        aggregate_id: created.external_id,
        payload: serializeConsumptionForOutbox(created),
      });
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          total_consumption: { increment: amount },
          last_consumption_at: new Date(),
        },
      });
      if (amount >= 0) {
        await this.projection.onConsumptionCreated(session.table_id, amount, tx);
      } else {
        await this.projection.onConsumptionReversed(
          session.table_id,
          Math.abs(amount),
          tx,
        );
      }
      return created;
    });

    this.emitBillUpdates(sessionId, session.table_id);
    return result;
  }

  /**
   * Customer pays part of the bill mid-session. Stored as a Consumption
   * with negative amount and type = partial_payment, so:
   *   - the bill's running total naturally drops by `amount` (= remaining
   *     to pay) without changing the sum-of-items reducer above;
   *   - the customer-facing receipt lists "Pago parcial — $X" as a line
   *     item, in chronological position;
   *   - real revenue accounting upstream still treats every partial as
   *     revenue at the moment it lands (the `amount` is mirrored into
   *     reports the same way other consumption rows are).
   *
   * Refused on closed sessions: a closed session is meant to be
   * append-only history. Use refundConsumption to undo a wrong partial.
   */
  async recordPartialPayment(
    sessionId: number,
    rawAmount: number,
    actor: AuditActor = null,
    paymentMethod: PaymentMethod = PaymentMethod.efectivo,
    // "Cada quien paga lo suyo": líneas de producto que este pago
    // cubre. Opcional — sin él, el parcial es un monto libre.
    allocations?: Array<{ consumption_id: number; quantity: number }>,
  ): Promise<ConsumptionFull> {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({
        message: "El monto del pago parcial debe ser positivo",
        code: "PARTIAL_PAYMENT_INVALID_AMOUNT",
      });
    }

    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; partial payments are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    // Block over-payment: the cashier shouldn't accidentally record a
    // partial bigger than what's left to pay. We re-read the bill total
    // (which already nets out previous partials) and refuse if amount
    // would push it negative. Equality is allowed — paying the exact
    // remaining is fine; staff just won't normally use partial-payment
    // for that, they use "Cobrar y cerrar".
    const pending = Number(session.total_consumption);
    if (amount > pending + 0.001) {
      throw new BadRequestException({
        message: `El pago supera el pendiente ($${pending}). Usa "Cobrar y cerrar" para liquidar.`,
        code: "PARTIAL_PAYMENT_EXCEEDS_PENDING",
      });
    }

    // Stored as negative so the existing sum reducer turns "total
    // consumption" into "remaining to pay" without special-casing.
    const negative = -this.round(amount);

    const description = `Pago parcial — ${this.formatCurrency(amount)}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const cashSession = await this.cashRegister.requireOpen(tx);
      const created = await tx.consumption.create({
        data: {
          table_session_id: sessionId,
          description,
          quantity: 1,
          unit_amount: negative,
          amount: negative,
          type: ConsumptionType.partial_payment,
          cash_register_session_id: cashSession.id,
          // No reason/notes: the description is the receipt's voice;
          // upstream audit log already records actor + timestamp.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });
      // Enqueue dentro de la misma tx. Ver invariante del outbox.
      await this.outbox.enqueue(tx, {
        event_type: "consumption.created",
        aggregate_type: "Consumption",
        aggregate_id: created.external_id,
        payload: serializeConsumptionForOutbox(created),
      });
      // Asignaciones a líneas específicas ("cada quien paga lo suyo"),
      // validadas y calculadas server-side dentro de la misma tx.
      if (allocations && allocations.length > 0) {
        await this.allocatePartialPayment(
          tx,
          sessionId,
          created,
          allocations,
          this.round(amount),
        );
      }
      // Registramos el Payment(kind=partial) en la misma tx. Es la
      // fuente de verdad para conciliación de caja: el consumption
      // negativo afecta el saldo, pero la caja se reconcilia contra
      // Payment.method=efectivo del día.
      await this.payments.recordPartial(tx, {
        table_session_id: sessionId,
        cash_register_session_id: cashSession.id,
        amount: this.round(amount),
        method: paymentMethod,
        consumption_id: created.id,
        actor,
      });
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          total_consumption: { increment: negative },
          last_consumption_at: new Date(),
        },
      });
      // The pending pesos drop by `amount`. Treat it as a reversal in
      // the projection so "total_consumption" on the table tile mirrors
      // what the customer sees.
      await this.projection.onConsumptionReversed(
        session.table_id,
        new Prisma.Decimal(amount),
        tx,
      );
      return created;
    });

    this.emitBillUpdates(sessionId, session.table_id);
    return result;
  }

  /**
   * Valida y persiste las asignaciones de un pago parcial a líneas de
   * producto. Corre DENTRO de la tx del pago:
   *
   *   1. SELECT ... FOR UPDATE sobre las líneas target — dos cajeros
   *      asignando la misma unidad en paralelo se serializan acá (el
   *      segundo ve el agregado actualizado y falla limpio).
   *   2. Cada target debe ser type=product de ESTA sesión, no
   *      reversado, y con unidades disponibles (quantity − ya asignado
   *      vivo). "Vivo" = asignaciones cuyo pago no está reversado.
   *   3. El monto por línea lo fija el server (unit_amount × quantity)
   *      y la suma debe cuadrar con el monto del pago — el cliente
   *      jamás manda montos por línea.
   */
  private async allocatePartialPayment(
    tx: Prisma.TransactionClient,
    sessionId: number,
    paymentConsumption: ConsumptionFull,
    allocations: Array<{ consumption_id: number; quantity: number }>,
    paymentAmount: number,
  ): Promise<void> {
    const ids = allocations.map((a) => a.consumption_id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        message: "Hay líneas repetidas en la asignación",
        code: "PARTIAL_ALLOCATION_DUPLICATE",
      });
    }

    // Lock pesimista de las líneas target. El agregado de "ya
    // asignado" de abajo solo es confiable si nadie más puede insertar
    // asignaciones sobre estas mismas líneas hasta que commiteemos.
    await tx.$queryRaw`
      SELECT id FROM "Consumption"
      WHERE id IN (${Prisma.join(ids)})
      FOR UPDATE
    `;

    const rows = await tx.consumption.findMany({
      where: { id: { in: ids } },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const alreadyAllocated = await tx.partialPaymentAllocation.groupBy({
      by: ["product_consumption_id"],
      where: {
        product_consumption_id: { in: ids },
        payment_consumption: { reversed_at: null },
      },
      _sum: { quantity: true },
    });
    const allocatedById = new Map(
      alreadyAllocated.map((a) => [
        a.product_consumption_id,
        a._sum.quantity ?? 0,
      ]),
    );

    let computedTotal = 0;
    const creates: Array<{
      product_consumption_id: number;
      quantity: number;
      amount: Prisma.Decimal;
    }> = [];
    for (const alloc of allocations) {
      const row = rowById.get(alloc.consumption_id);
      if (!row) {
        throw new BadRequestException({
          message: `Línea ${alloc.consumption_id} no existe`,
          code: "PARTIAL_ALLOCATION_NOT_FOUND",
        });
      }
      if (
        row.type !== ConsumptionType.product ||
        row.table_session_id !== sessionId ||
        row.reversed_at !== null
      ) {
        throw new BadRequestException({
          message: `Línea ${alloc.consumption_id} no es un producto activo de esta cuenta`,
          code: "PARTIAL_ALLOCATION_INVALID_TARGET",
        });
      }
      const available =
        row.quantity - (allocatedById.get(row.id) ?? 0);
      if (alloc.quantity > available) {
        throw new BadRequestException({
          message: `"${row.description}": solo quedan ${available} unidad(es) sin pagar`,
          code: "PARTIAL_ALLOCATION_EXCEEDS_AVAILABLE",
        });
      }
      const lineAmount = this.round(
        Number(row.unit_amount) * alloc.quantity,
      );
      computedTotal += lineAmount;
      creates.push({
        product_consumption_id: row.id,
        quantity: alloc.quantity,
        amount: new Prisma.Decimal(lineAmount),
      });
    }

    computedTotal = this.round(computedTotal);
    if (Math.abs(computedTotal - paymentAmount) > 0.01) {
      throw new BadRequestException({
        message: `El monto no cuadra con los productos seleccionados (esperado $${computedTotal})`,
        code: "PARTIAL_ALLOCATION_AMOUNT_MISMATCH",
      });
    }

    // createManyAndReturn para tener los external_id de vuelta sin una
    // segunda query — van al payload del outbox.
    const createdAllocs = await tx.partialPaymentAllocation.createManyAndReturn({
      data: creates.map((c) => ({
        payment_consumption_id: paymentConsumption.id,
        ...c,
      })),
    });

    const externalIdByRowId = new Map(
      rows.map((r) => [r.id, r.external_id]),
    );
    await this.outbox.enqueue(tx, {
      event_type: "partial_payment.allocated",
      aggregate_type: "PartialPaymentAllocation",
      aggregate_id: paymentConsumption.external_id,
      payload: {
        payment_consumption_external_id: paymentConsumption.external_id,
        table_session_id: sessionId,
        allocations: createdAllocs.map((a) => ({
          external_id: a.external_id,
          product_consumption_external_id:
            externalIdByRowId.get(a.product_consumption_id) ?? "",
          quantity: a.quantity,
          amount: Number(a.amount),
        })),
      },
    });
  }

  private formatCurrency(n: number): string {
    // Receipt label only — the bill UI re-formats with locale rules.
    // We just want a sane "$123.456" in the description column.
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `$${n}`;
    }
  }

  async refundConsumption(
    consumptionId: number,
    dto: RefundConsumptionDto,
    actor: AuditActor = null,
  ): Promise<ConsumptionFull> {
    const original = await this.prisma.consumption.findUnique({
      where: { id: consumptionId },
      include: {
        table_session: {
          select: { id: true, table_id: true, status: true },
        },
      },
    });
    if (!original) {
      throw new NotFoundException(`Consumption ${consumptionId} not found`);
    }
    if (original.type === ConsumptionType.refund) {
      throw new BadRequestException({
        message: "Cannot refund a refund entry",
        code: "REFUND_INVALID_TARGET",
      });
    }
    if (original.reversed_at) {
      throw new ConflictException({
        message: `Consumption ${consumptionId} is already reversed`,
        code: "CONSUMPTION_ALREADY_REVERSED",
      });
    }
    if (original.table_session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; refunds are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const refundAmount = new Prisma.Decimal(original.amount).neg();
    // Default true: reponer stock al revertir. Solo se omite si el
    // operador marca explícitamente que el producto no se recupera
    // físicamente (rotura, derrame, ya consumido).
    const restoreStock = dto.restore_stock !== false;

    const result = await this.prisma.$transaction(async (tx) => {
      // Un producto con asignaciones VIVAS de pago parcial no se puede
      // devolver: la contabilidad diría "pagado" sobre una línea que ya
      // no existe. El camino es reversar primero el pago parcial que lo
      // cubre (eso "apaga" sus asignaciones) y ahí sí devolver.
      if (original.type === ConsumptionType.product) {
        const live = await tx.partialPaymentAllocation.aggregate({
          where: {
            product_consumption_id: consumptionId,
            payment_consumption: { reversed_at: null },
          },
          _sum: { quantity: true },
        });
        if ((live._sum.quantity ?? 0) > 0) {
          throw new ConflictException({
            message:
              "Esta línea tiene un pago parcial asignado. Reversa primero ese pago parcial y luego devuélvela.",
            code: "PRODUCT_HAS_LIVE_ALLOCATIONS",
          });
        }
      }

      const marked = await tx.consumption.updateMany({
        where: { id: consumptionId, reversed_at: null },
        data: { reversed_at: new Date() },
      });
      if (marked.count === 0) {
        throw new ConflictException({
          message: `Consumption ${consumptionId} was already reversed concurrently`,
          code: "CONSUMPTION_ALREADY_REVERSED",
        });
      }

      const cashSession = await this.cashRegister.getCurrentOpen(tx);
      const created = await tx.consumption.create({
        data: {
          table_session_id: original.table_session_id,
          order_id: original.order_id,
          product_id: original.product_id,
          description: `Refund: ${original.description}`,
          quantity: original.quantity,
          unit_amount: new Prisma.Decimal(original.unit_amount).neg(),
          amount: refundAmount,
          type: ConsumptionType.refund,
          reverses_id: consumptionId,
          cash_register_session_id: cashSession?.id ?? null,
          reason: dto.reason,
          notes: dto.notes ?? null,
          // Audit rule: see createAdjustment.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });
      // Enqueue dentro de la misma tx. El refund es una fila NUEVA de
      // Consumption (no un update del original), así que emite
      // consumption.created — el cloud verá reverses_id != null y sabrá
      // que es un refund.
      await this.outbox.enqueue(tx, {
        event_type: "consumption.created",
        aggregate_type: "Consumption",
        aggregate_id: created.external_id,
        payload: serializeConsumptionForOutbox(created),
      });

      await tx.tableSession.update({
        where: { id: original.table_session_id },
        data: {
          total_consumption: { increment: refundAmount },
          last_consumption_at: new Date(),
        },
      });
      await this.projection.onConsumptionReversed(
        original.table_session.table_id,
        new Prisma.Decimal(original.amount),
        tx,
      );

      // Reponer stock cuando aplica. Buscamos el OrderItem y sus
      // componentes (compuestos) o el product_id directo (simples).
      let affected: number[] = [];
      if (restoreStock && original.order_id && original.product_id) {
        affected = await this.restoreStockForRefund(
          tx,
          original.order_id,
          original.product_id,
          original.quantity,
        );
      }

      return { created, affected };
    });

    this.emitBillUpdates(
      original.table_session_id,
      original.table_session.table_id,
    );
    if (result.affected.length > 0) {
      void this.products.broadcastChanged(result.affected);
    }
    return result.created;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private describeAdjustment(type: ConsumptionType, reason: string): string {
    const label = type === ConsumptionType.discount ? "Discount" : "Adjustment";
    return `${label}: ${reason}`;
  }

  private summarize(items: Consumption[]): BillSummary {
    let subtotal = 0;
    let discounts = 0;
    let adjustments = 0;
    let partials = 0;
    for (const item of items) {
      const n = Number(item.amount);
      switch (item.type) {
        case ConsumptionType.product:
          subtotal += n;
          break;
        case ConsumptionType.discount:
          discounts += n;
          break;
        case ConsumptionType.adjustment:
        case ConsumptionType.refund:
          adjustments += n;
          break;
        case ConsumptionType.partial_payment:
          partials += n;
          break;
      }
    }
    return {
      subtotal: this.round(subtotal),
      discounts_total: this.round(discounts),
      adjustments_total: this.round(adjustments),
      partial_payments_total: this.round(partials),
      total: this.round(subtotal + discounts + adjustments + partials),
      item_count: items.length,
    };
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Repone stock al hacer refund sobre una venta concreta. Busca el
   * OrderItem que coincide con (order_id, product_id) y:
   *   - Si tiene OrderItemComponent rows → repone los componentes
   *     en las cantidades exactas que se descontaron al aceptar.
   *   - Si NO tiene componentes (producto simple) → repone el propio
   *     producto en `consumptionQuantity` unidades.
   *
   * Idempotencia: NO marcamos los OrderItemComponent como
   * "ya repuestos". Un refund doble del mismo Consumption ya está
   * bloqueado por el check `reversed_at != null` arriba, así que
   * acá no hay riesgo de reponer dos veces.
   */
  private async restoreStockForRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
    productId: number,
    consumptionQuantity: number,
  ): Promise<number[]> {
    const affected = new Set<number>();
    const orderItem = await tx.orderItem.findFirst({
      where: { order_id: orderId, product_id: productId },
      include: { components: true },
    });
    if (!orderItem) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: consumptionQuantity } },
      });
      affected.add(productId);
      return Array.from(affected);
    }
    if (orderItem.components.length > 0) {
      const ratio = consumptionQuantity / orderItem.quantity;
      const totals = new Map<number, number>();
      for (const c of orderItem.components) {
        const restore = Math.round(c.quantity * ratio);
        totals.set(
          c.component_product_id,
          (totals.get(c.component_product_id) ?? 0) + restore,
        );
      }
      for (const [componentId, qty] of totals) {
        if (qty > 0) {
          await tx.product.update({
            where: { id: componentId },
            data: { stock: { increment: qty } },
          });
          affected.add(componentId);
        }
      }
      // El producto compuesto en sí no cambió stock, pero incluirlo
      // ayuda a que la grilla admin lo recomponga (la availability sí
      // puede haber cambiado).
      affected.add(productId);
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: consumptionQuantity } },
      });
      affected.add(productId);
    }
    return Array.from(affected);
  }

  async emitBillSnapshot(sessionId: number, tableId: number) {
    const bill = await this.getBill(sessionId);
    this.realtime.emitBillUpdated(sessionId, bill);
    this.realtime.emitTableSessionUpdated(sessionId, {
      id: sessionId,
      total_consumption: bill.summary.total,
    });
    const snapshot = await this.projection.snapshotForBroadcast(tableId);
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
  }

  private async emitBillUpdates(sessionId: number, tableId: number) {
    await this.emitBillSnapshot(sessionId, tableId);
  }

  serialize(consumption: ConsumptionFull, extras?: BillSerializeExtras) {
    // Los enriquecimientos solo aplican dentro del BillView (getBill
    // pasa `extras`); para call sites sueltos quedan undefined y se
    // omiten del JSON — campos aditivos/opcionales.
    const composition =
      extras?.compositions !== undefined &&
      consumption.type === ConsumptionType.product &&
      consumption.order_id != null &&
      consumption.product_id != null
        ? extras.compositions.get(
            `${consumption.order_id}:${consumption.product_id}`,
          )
        : undefined;
    // Unidades ya cubiertas por pagos parciales vivos. 0 explícito para
    // líneas de producto (la UI distingue "sin pagar" de "no sé").
    const paid_quantity =
      extras?.paidByProduct !== undefined &&
      consumption.type === ConsumptionType.product
        ? (extras.paidByProduct.get(consumption.id) ?? 0)
        : undefined;
    const allocations =
      extras?.allocationsByPayment !== undefined &&
      consumption.type === ConsumptionType.partial_payment
        ? extras.allocationsByPayment.get(consumption.id)
        : undefined;
    return {
      ...consumption,
      unit_amount: Number(consumption.unit_amount),
      amount: Number(consumption.amount),
      reverses: consumption.reverses
        ? { ...consumption.reverses, amount: Number(consumption.reverses.amount) }
        : null,
      composition,
      paid_quantity,
      allocations,
    };
  }
}
