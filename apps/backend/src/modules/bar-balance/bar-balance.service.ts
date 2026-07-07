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
 * El saldo mostrado se DERIVA, nunca se persiste:
 *
 *   efectivo = baseline.cash + Σ (declared − opening) por cada
 *              CashRegisterSession CERRADA con closed_at > set_at
 *   bold     = baseline.bold + Σ (cobros Bold − egresos Bold netos)
 *              de esas mismas sesiones
 *
 * Por qué (declared − opening) y no (ventas − gastos): `declared` es
 * lo que el cajero CONTÓ físicamente al cerrar — ya incluye ventas,
 * gastos, vueltos mal dados y cualquier descuadre real. Es la verdad
 * física, no la teórica. Si la jornada actual está abierta, su
 * movimiento NO cuenta todavía (entra al saldo cuando se cierre).
 *
 * Para Bold no hay "conteo físico": el neto se calcula de los
 * Payment (tarjeta+QR, reversos incluidos vía signo) menos los
 * Expense pagados con Bold de la sesión.
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
      select: {
        id: true,
        opening_balance: true,
        closing_balance_declared: true,
      },
    });

    let cash = Number(baseline.cash_amount);
    let bold = Number(baseline.bold_amount);

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);

      // Efectivo: delta físico por sesión = declarado − base apertura.
      for (const s of sessions) {
        const declared =
          s.closing_balance_declared !== null
            ? Number(s.closing_balance_declared)
            : null;
        // Sin declarado (no debería pasar en cerradas) → delta 0.
        if (declared !== null) {
          cash += declared - Number(s.opening_balance);
        }
      }

      // Bold: cobros netos (los reversal vienen con amount negativo,
      // la SUM ya netea) − egresos netos pagados con Bold.
      const boldPayments = await this.prisma.payment.aggregate({
        where: {
          cash_register_session_id: { in: sessionIds },
          method: {
            in: [PaymentMethod.tarjeta_bold, PaymentMethod.qr_bold],
          },
        },
        _sum: { amount: true },
      });
      const boldExpenses = await this.prisma.expense.aggregate({
        where: {
          cash_register_session_id: { in: sessionIds },
          method: {
            in: [PaymentMethod.tarjeta_bold, PaymentMethod.qr_bold],
          },
        },
        _sum: { amount: true },
      });
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
