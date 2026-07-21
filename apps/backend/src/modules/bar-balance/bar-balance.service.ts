import {
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  CashRegisterStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export type Actor = { user_id: number; name: string } | null;

/**
 * Código de autorización para editar la línea base del saldo.
 *
 * Requisito operativo explícito del dueño: el saldo NO debe parecer
 * editable — la UI lo esconde tras un gesto discreto y luego pide
 * este código. Se valida server-side (acá) para que no sea legible
 * desde el bundle JS del navegador.
 *
 * Deliberadamente NO vive en variables de entorno: el dueño pidió un
 * código quemado concreto. Si algún día se rota, cambiarlo acá y
 * redeployar (queda en el historial de git — aceptado).
 */
const BAR_BALANCE_EDIT_CODE = "2906";

/**
 * BarBalanceService — "cuánta plata hay en el bar".
 *
 * El saldo mostrado se DERIVA, nunca se persiste. Regla única para
 * AMBOS métodos (cada cobro suma, cada gasto resta):
 *
 *   efectivo = baseline.cash
 *              + Σ cobros efectivo   (Payment method=efectivo)
 *              − Σ gastos efectivo   (Expense method=efectivo)
 *   bold     = baseline.bold
 *              + Σ cobros Bold       (Payment tarjeta+qr)
 *              − Σ gastos Bold       (Expense tarjeta+qr)
 *
 * ...sobre las CashRegisterSession CERRADAS con closed_at > set_at.
 * Los reversos (kind=reversal) traen amount negativo, así que las
 * SUMs ya netean.
 *
 * Por qué NO `declared − opening` para el efectivo (bug corregido
 * 2026-07-20): la caja física se ABRE con una base de vueltos, no
 * con todo el efectivo del bar, y al cierre solo se cuenta lo que
 * quedó en esa caja chica. `declared − opening` medía el cambio de
 * la caja chica, no del efectivo TOTAL del negocio — inflaba el
 * saldo con el descuadre del cierre. El saldo del bar es
 * simplemente lo que entró menos lo que salió.
 *
 * Si la jornada actual está abierta, su movimiento NO cuenta todavía
 * (entra al saldo cuando se cierre).
 */
@Injectable()
export class BarBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saldo actual derivado. Si nunca se ha fijado una línea base,
   * devuelve `configured: false` — la UI muestra el estado "sin
   * configurar" y ofrece fijarla (con código).
   */
  async getCurrent(): Promise<{
    configured: boolean;
    cash: number;
    bold: number;
    baseline_set_at: string | null;
    sessions_since_baseline: number;
  }> {
    const baseline = await this.prisma.barBalanceBaseline.findFirst({
      orderBy: { set_at: "desc" },
    });
    if (!baseline) {
      return {
        configured: false,
        cash: 0,
        bold: 0,
        baseline_set_at: null,
        sessions_since_baseline: 0,
      };
    }

    // Sesiones cerradas DESPUÉS de fijar la línea base. La sesión
    // abierta actual no cuenta (su efecto entra al cerrar).
    const sessions = await this.prisma.cashRegisterSession.findMany({
      where: {
        status: CashRegisterStatus.closed,
        closed_at: { gt: baseline.set_at },
      },
      select: { id: true },
    });

    let cash = Number(baseline.cash_amount);
    let bold = Number(baseline.bold_amount);

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);

      // Regla unificada para AMBOS métodos: cada cobro suma, cada
      // gasto resta. Los reversos (Payment/Expense kind=reversal)
      // vienen con amount negativo, así que la SUM ya netea.
      //
      // NO se usa `declarado − apertura` para el efectivo: eso medía
      // el cambio de la CAJA CHICA física (que se abre con una base
      // de vueltos, no con todo el efectivo del bar) y no tenía
      // relación con cuánto creció/decreció el efectivo TOTAL del
      // negocio. El saldo del bar es "cuánta plata hay en total": lo
      // que entró por cobros menos lo que salió por gastos.
      const [cashPayments, cashExpenses, boldPayments, boldExpenses] =
        await Promise.all([
          this.prisma.payment.aggregate({
            where: {
              cash_register_session_id: { in: sessionIds },
              method: PaymentMethod.efectivo,
            },
            _sum: { amount: true },
          }),
          this.prisma.expense.aggregate({
            where: {
              cash_register_session_id: { in: sessionIds },
              method: PaymentMethod.efectivo,
            },
            _sum: { amount: true },
          }),
          this.prisma.payment.aggregate({
            where: {
              cash_register_session_id: { in: sessionIds },
              method: {
                in: [PaymentMethod.tarjeta_bold, PaymentMethod.qr_bold],
              },
            },
            _sum: { amount: true },
          }),
          this.prisma.expense.aggregate({
            where: {
              cash_register_session_id: { in: sessionIds },
              method: {
                in: [PaymentMethod.tarjeta_bold, PaymentMethod.qr_bold],
              },
            },
            _sum: { amount: true },
          }),
        ]);

      cash +=
        Number(cashPayments._sum.amount ?? 0) -
        Number(cashExpenses._sum.amount ?? 0);
      bold +=
        Number(boldPayments._sum.amount ?? 0) -
        Number(boldExpenses._sum.amount ?? 0);
    }

    return {
      configured: true,
      cash,
      bold,
      baseline_set_at: baseline.set_at.toISOString(),
      sessions_since_baseline: sessions.length,
    };
  }

  /**
   * Fijar (o corregir) la línea base. Requiere el código de
   * autorización. Append-only: inserta una fila nueva — el historial
   * de correcciones queda completo para auditoría.
   */
  async setBaseline(input: {
    code: string;
    cash_amount: number;
    bold_amount: number;
    note?: string;
    actor: Actor;
  }): Promise<{ ok: true }> {
    if (input.code !== BAR_BALANCE_EDIT_CODE) {
      throw new ForbiddenException({
        message: "Invalid authorization code",
        code: "BAR_BALANCE_INVALID_CODE",
      });
    }
    await this.prisma.barBalanceBaseline.create({
      data: {
        cash_amount: new Prisma.Decimal(input.cash_amount),
        bold_amount: new Prisma.Decimal(input.bold_amount),
        note: input.note?.trim() || null,
        set_by: input.actor?.name ?? null,
      },
    });
    return { ok: true };
  }
}
