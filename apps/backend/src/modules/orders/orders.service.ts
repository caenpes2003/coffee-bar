import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConsumptionType,
  Order,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ConsumptionsService } from "../consumptions/consumptions.service";
import { ProductsService } from "../products/products.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";

type Tx = Prisma.TransactionClient;

const ORDER_INCLUDE = {
  order_items: {
    include: {
      product: true,
      // Componentes físicos para productos compuestos. Vacío para
      // simples. Usado por restoreStock para reposición exacta.
      components: true,
    },
  },
  table_session: { select: { id: true, table_id: true, status: true } },
} satisfies Prisma.OrderInclude;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Direct accepted→delivered is the default UI flow today (single
  // "ENTREGAR" button); the legacy preparing / ready intermediates remain
  // valid so we can re-enable a kitchen-screen flow without a migration.
  [OrderStatus.accepted]: [
    OrderStatus.delivered,
    OrderStatus.preparing,
    OrderStatus.cancelled,
  ],
  [OrderStatus.preparing]: [OrderStatus.ready, OrderStatus.cancelled],
  [OrderStatus.ready]: [OrderStatus.delivered, OrderStatus.cancelled],
  [OrderStatus.delivered]: [],
  [OrderStatus.cancelled]: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
    private readonly consumptions: ConsumptionsService,
    private readonly products: ProductsService,
  ) {}

  async findAll(filter?: {
    status?: OrderStatus;
    tableSessionId?: number;
  }): Promise<OrderFull[]> {
    const where: Prisma.OrderWhereInput = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.tableSessionId)
      where.table_session_id = filter.tableSessionId;
    const orders = await this.prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { created_at: "desc" },
    });
    return orders;
  }

  async findOne(id: number): Promise<OrderFull> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async updateStatus(
    id: number,
    nextStatus: OrderStatus,
  ): Promise<OrderFull> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        // `components` viaja con cada order_item para que la cancelación
        // de compuestos arme el plan exacto de reposición (sin esto la
        // cancelación de un cubetazo mix no devolvía las cervezas reales
        // — caía en el fallback de simple y trataba de sumar al stock
        // del propio compuesto, que no se descuenta nunca).
        order_items: { include: { components: true } },
        table_session: { select: { id: true, table_id: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const allowed = TRANSITIONS[order.status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException({
        message: `Invalid transition ${order.status} -> ${nextStatus}`,
        code: "ORDER_INVALID_TRANSITION",
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.order.updateMany({
        where: { id, status: order.status },
        data: this.transitionData(nextStatus),
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          message: `Order ${id} was modified concurrently`,
          code: "ORDER_RACE",
        });
      }

      if (nextStatus === OrderStatus.delivered) {
        await this.emitConsumptions(tx, order);
        await this.projection.onOrderLeftActive(
          order.table_session.table_id,
          tx,
        );
      } else if (nextStatus === OrderStatus.cancelled) {
        await this.restoreStock(tx, order.order_items);
        await this.projection.onOrderLeftActive(
          order.table_session.table_id,
          tx,
        );
      }

      const fresh = await tx.order.findUnique({
        where: { id },
        include: ORDER_INCLUDE,
      });
      return fresh!;
    });

    this.realtime.emitOrderUpdated(
      order.table_session_id,
      this.serialize(result),
    );
    const snap = await this.projection.snapshotForBroadcast(
      order.table_session.table_id,
    );
    if (snap) this.realtime.emitTableUpdated(snap);
    if (nextStatus === OrderStatus.delivered) {
      await this.consumptions.emitBillSnapshot(
        order.table_session_id,
        order.table_session.table_id,
      );
    }
    // Tras una cancelación se repuso stock; broadcasteamos los productos
    // afectados (incluye compuestos que dependen de los componentes
    // repuestos) para que la mesa y la grilla admin se actualicen sin
    // recargar la página.
    if (nextStatus === OrderStatus.cancelled) {
      const ids = this.collectAffectedProductIds(order.order_items);
      void this.products.broadcastChanged(ids);
    }
    return result;
  }

  private collectAffectedProductIds(
    items: Array<{
      product_id: number;
      components?: Array<{ component_product_id: number }>;
    }>,
  ): number[] {
    const ids = new Set<number>();
    for (const it of items) {
      ids.add(it.product_id);
      for (const c of it.components ?? []) ids.add(c.component_product_id);
    }
    return Array.from(ids);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private transitionData(next: OrderStatus): Prisma.OrderUncheckedUpdateInput {
    const now = new Date();
    const data: Prisma.OrderUncheckedUpdateInput = { status: next };
    if (next === OrderStatus.delivered) data.delivered_at = now;
    if (next === OrderStatus.cancelled) data.cancelled_at = now;
    return data;
  }

  /**
   * Repone stock al cancelar un Order. Para productos compuestos
   * usa los OrderItemComponent reales (los componentes físicos que
   * efectivamente salieron); para simples usa quantity del OrderItem.
   * Esto garantiza reversión exacta — si una venta fue "3 aguila +
   * 3 poker" en un armable, repone exactamente eso, no el default.
   */
  private async restoreStock(
    tx: Tx,
    items: Array<{
      id: number;
      product_id: number;
      quantity: number;
      components?: Array<{ component_product_id: number; quantity: number }>;
    }>,
  ) {
    // Recopilar componentes a reponer aparte para hacer un solo
    // update por componente.
    const totals = new Map<number, number>();
    for (const item of items) {
      // Si llegó con components, es un compuesto: reponer
      // exactamente esos componentes.
      const fromComponents = item.components ?? [];
      if (fromComponents.length > 0) {
        for (const c of fromComponents) {
          totals.set(
            c.component_product_id,
            (totals.get(c.component_product_id) ?? 0) + c.quantity,
          );
        }
      } else {
        // Producto simple: reponer al mismo product_id.
        totals.set(
          item.product_id,
          (totals.get(item.product_id) ?? 0) + item.quantity,
        );
      }
    }
    for (const [productId, qty] of totals) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: qty } },
      });
    }
  }

  private async emitConsumptions(
    tx: Tx,
    order: Order & {
      order_items: Array<{
        product_id: number;
        quantity: number;
        unit_price: Prisma.Decimal;
      }>;
      table_session: { table_id: number };
    },
  ) {
    const products = await tx.product.findMany({
      where: { id: { in: order.order_items.map((i) => i.product_id) } },
      select: { id: true, name: true, price: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    let totalDelta = new Prisma.Decimal(0);
    // Acumulamos mismatches detectados para reportarlos UNA vez al final
    // del ciclo (un solo AuditLog + un solo emit por order). Reportar
    // por item inundaría el panel admin si una orden tiene varios items
    // con precio cambiado.
    const priceMismatches: Array<{
      product_id: number;
      product_name: string;
      sold_unit_price: number;
      current_unit_price: number;
      quantity: number;
    }> = [];

    for (const item of order.order_items) {
      const amount = new Prisma.Decimal(item.unit_price).mul(item.quantity);
      totalDelta = totalDelta.add(amount);
      const product = productById.get(item.product_id);
      await tx.consumption.create({
        data: {
          table_session_id: order.table_session_id,
          order_id: order.id,
          product_id: item.product_id,
          description: product?.name ?? `Product ${item.product_id}`,
          quantity: item.quantity,
          unit_amount: item.unit_price,
          amount,
          type: ConsumptionType.product,
        },
      });

      // Comparación de seguridad: el OrderItem se creó con `unit_price`
      // = Product.price del momento de aceptar. Si al ENTREGAR (ahora)
      // el Product.price es distinto, eso significa que el precio fue
      // editado entre accept y deliver — operativamente válido pero
      // contablemente anómalo (puede esconder un cambio mal intencionado
      // de tarifa para una venta puntual). Lo registramos para que el
      // admin vea la anomalía sin bloquear la entrega.
      if (product) {
        const sold = Number(item.unit_price);
        const current = Number(product.price);
        if (sold !== current) {
          priceMismatches.push({
            product_id: item.product_id,
            product_name: product.name,
            sold_unit_price: sold,
            current_unit_price: current,
            quantity: item.quantity,
          });
        }
      }
    }

    await tx.tableSession.update({
      where: { id: order.table_session_id },
      data: {
        total_consumption: { increment: totalDelta },
        last_consumption_at: new Date(),
      },
    });

    await this.projection.onConsumptionCreated(
      order.table_session.table_id,
      totalDelta,
      tx,
    );

    if (priceMismatches.length > 0) {
      // No tiramos el AuditLog ni el emit dentro de la transacción para
      // no comprometer la entrega si esos paths fallan — es información
      // observacional, no transaccional.
      this.notifyPriceMismatch(order, priceMismatches);
    }
  }

  /**
   * Emite un AuditLog + un evento socket para que el operador vea al
   * instante cuando una orden se entrega con precios que difieren del
   * precio vigente del producto. Best-effort: nunca lanza errores hacia
   * el caller — la entrega ya pasó.
   */
  private notifyPriceMismatch(
    order: { id: number; table_session_id: number },
    mismatches: Array<{
      product_id: number;
      product_name: string;
      sold_unit_price: number;
      current_unit_price: number;
      quantity: number;
    }>,
  ): void {
    void (async () => {
      try {
        // AuditLog: queda en histórico aunque nadie esté mirando.
        // Reusamos `kind: bill_adjustment` con metadata específica para
        // no requerir migration del enum AuditEventKind. El frontend
        // sabrá distinguirlo por la presencia de `mismatches`.
        await this.prisma.auditLog.create({
          data: {
            kind: "bill_adjustment",
            summary: `Venta con precio diferente al actual (${mismatches.length} producto${mismatches.length > 1 ? "s" : ""})`,
            metadata: {
              event_subtype: "price_mismatch_at_delivery",
              order_id: order.id,
              session_id: order.table_session_id,
              mismatches,
            },
          },
        });
      } catch (err) {
        // Silencioso a propósito: la operación primaria (entrega) ya
        // se completó. Esto es observacional. Log a stderr para Sentry.
        console.error("[orders] price-mismatch audit failed", err);
      }
      try {
        // Toast en tiempo real para el dashboard admin.
        this.realtime.emitToStaffCustom("price-mismatch", {
          order_id: order.id,
          session_id: order.table_session_id,
          mismatches,
        });
      } catch (err) {
        console.error("[orders] price-mismatch emit failed", err);
      }
    })();
  }

  serialize(order: OrderFull) {
    return {
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        unit_price: Number(item.unit_price),
        product: {
          ...item.product,
          price: Number(item.product.price),
        },
      })),
    };
  }

  static readonly ACTIVE_STATUSES = ACTIVE_STATUSES;
  static readonly TRANSITIONS = TRANSITIONS;
}
