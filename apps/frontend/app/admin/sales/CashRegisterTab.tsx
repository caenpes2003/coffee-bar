"use client";

import { useCallback, useEffect, useState } from "react";
import { cashRegisterApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useEscapeKey } from "@/lib/hooks/useEscapeKey";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt } from "@/lib/theme";
import type {
  CashRegisterSession,
  CashRegisterSessionDetail,
} from "@coffee-bar/shared";

/**
 * Tab "Caja" del /admin/sales (Fase A+ B3.6a).
 *
 * Muestra el histórico de jornadas (CashRegisterSession). Por cada
 * fila: rango de fechas, base de apertura, declarado al cierre,
 * esperado calculado por el backend y diferencia (con color).
 *
 * Hacer click en una fila abre un modal de detalle que reusa el shape
 * de `getSessionDetail` con totales por método, igual que el ticket
 * de cierre — pero en read-only.
 *
 * Hoy lista las últimas 50 sesiones (no paginado). Si el bar crece y
 * eso se queda corto, agregamos `?limit=` configurable o paginación
 * server-side. Hoy 50 cubre ~50 días, más que suficiente.
 */

export function CashRegisterTab() {
  const [sessions, setSessions] = useState<CashRegisterSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await cashRegisterApi.list({ limit: 50 });
      setSessions(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <header>
        <h2
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            letterSpacing: 0.5,
            color: C.ink,
          }}
        >
          Histórico de jornadas
        </h2>
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1,
            color: C.mute,
          }}
        >
          Últimas 50 sesiones. Hacé click en una fila para ver el detalle.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 12,
            background: C.terracottaSoft,
            color: C.terracotta,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          {error}
        </p>
      )}

      {sessions === null && !error && (
        <p
          style={{
            margin: 0,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          Cargando jornadas…
        </p>
      )}

      {sessions !== null && sessions.length === 0 && (
        <p
          style={{
            margin: 0,
            padding: "20px 16px",
            background: C.cream,
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: C.cacao,
            textAlign: "center",
          }}
        >
          Aún no hay jornadas registradas.
        </p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <SessionTable
          sessions={sessions}
          onSelect={(id) => setSelectedId(id)}
        />
      )}

      {selectedId !== null && (
        <SessionDetailModal
          sessionId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}

// ─── Tabla de sesiones ─────────────────────────────────────────────────────

function SessionTable({
  sessions,
  onSelect,
}: {
  sessions: CashRegisterSession[];
  onSelect: (id: number) => void;
}) {
  return (
    // overflowX: la tabla tiene 6 columnas (~660px mínimo). En móvil
    // scrollea horizontal dentro de su propio contenedor en lugar de
    // desbordar la página (body tiene overflow-x hidden y la cortaría).
    <div
      style={{
        border: `1px solid ${C.sand}`,
        borderRadius: 12,
        overflowX: "auto",
        background: C.paper,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(120px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(90px, 1fr)",
          gap: 0,
          padding: "10px 14px",
          background: C.cream,
          borderBottom: `1px solid ${C.sand}`,
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 1.5,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        <span>Apertura</span>
        <span>Cierre</span>
        <span>Base</span>
        <span>Esperado</span>
        <span>Declarado</span>
        <span>Diferencia</span>
      </div>
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} onSelect={() => onSelect(s.id)} />
      ))}
    </div>
  );
}

function SessionRow({
  session,
  onSelect,
}: {
  session: CashRegisterSession;
  onSelect: () => void;
}) {
  const isOpen = session.status === "open";
  const declared =
    session.closing_balance_declared !== null
      ? Number(session.closing_balance_declared)
      : null;
  const expected =
    session.closing_balance_expected !== null
      ? Number(session.closing_balance_expected)
      : null;
  const difference =
    session.difference !== null ? Number(session.difference) : null;
  const diffColor =
    difference === null
      ? C.mute
      : Math.abs(difference) < 0.5
        ? C.olive
        : difference > 0
          ? C.gold
          : C.terracotta;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(120px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(90px, 1fr)",
        gap: 0,
        padding: "12px 14px",
        background: "transparent",
        border: "none",
        borderBottom: `1px solid ${C.sand}`,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: C.ink,
        width: "100%",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 700 }}>
          {formatDateTime(session.opened_at)}
        </span>
        {session.opened_via_bypass && (
          <span
            style={{
              fontSize: 9,
              letterSpacing: 1,
              color: C.terracotta,
              marginTop: 2,
              textTransform: "uppercase",
            }}
            title={session.opened_bypass_reason ?? ""}
          >
            ⚠ excepcional
          </span>
        )}
      </span>
      <span>
        {isOpen ? (
          <em
            style={{
              color: C.olive,
              fontStyle: "normal",
              letterSpacing: 1,
              textTransform: "uppercase",
              fontWeight: 700,
              fontSize: 10,
            }}
          >
            ● abierta
          </em>
        ) : session.closed_at ? (
          formatDateTime(session.closed_at)
        ) : (
          "—"
        )}
      </span>
      <span>{fmt(Number(session.opening_balance))}</span>
      <span>{expected !== null ? fmt(expected) : "—"}</span>
      <span>{declared !== null ? fmt(declared) : "—"}</span>
      <span style={{ color: diffColor, fontWeight: 700 }}>
        {difference === null
          ? "—"
          : `${difference >= 0 ? "+" : ""}${fmt(difference)}`}
      </span>
    </button>
  );
}

// ─── Modal de detalle (read-only) ─────────────────────────────────────────

function SessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CashRegisterSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onClose);

  useEffect(() => {
    cashRegisterApi
      .detail(sessionId)
      .then(setDetail)
      .catch((err: unknown) => setError(getErrorMessage(err)));
  }, [sessionId]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Detalle de jornada"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <header>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.cacao,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Detalle de jornada
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "4px 0 0",
            }}
          >
            {detail
              ? formatDateTime(detail.session.opened_at)
              : "Cargando…"}
          </h3>
        </header>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 10,
              background: C.terracottaSoft,
              color: C.terracotta,
              borderRadius: 8,
              fontFamily: FONT_MONO,
              fontSize: 11,
            }}
          >
            {error}
          </p>
        )}

        {detail && <DetailTicket detail={detail} />}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: C.ink,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailTicket({ detail }: { detail: CashRegisterSessionDetail }) {
  const { session, totals_by_method } = detail;
  const opening = Number(session.opening_balance);
  const cashIn = totals_by_method.efectivo.amount;
  const bold = totals_by_method.tarjeta_bold.amount;
  const qr = totals_by_method.qr_bold.amount;
  const extras = detail.extra_income_total + detail.luggage_total;
  const cashOut = detail.expenses_by_method.efectivo;
  const cardOut = detail.expenses_by_method.tarjeta_bold;
  const qrOut = detail.expenses_by_method.qr_bold;
  const expensesTotal = detail.expenses_total;
  const boldNet = bold + qr - (cardOut + qrOut);
  const expected =
    session.closing_balance_expected !== null
      ? Number(session.closing_balance_expected)
      : opening + cashIn - cashOut;
  const declared =
    session.closing_balance_declared !== null
      ? Number(session.closing_balance_declared)
      : null;
  const difference =
    session.difference !== null ? Number(session.difference) : null;
  return (
    <div
      style={{
        background: C.cream,
        border: `1px solid ${C.sand}`,
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: FONT_MONO,
        fontSize: 12,
      }}
    >
      <Row label="Base de apertura" value={fmt(opening)} />
      {session.opened_via_bypass && session.opened_bypass_reason && (
        <Row
          label="Motivo excepcional"
          value={session.opened_bypass_reason}
          dim
        />
      )}
      <Divider />
      <Row
        label="Efectivo"
        value={fmt(cashIn)}
        hint={`${totals_by_method.efectivo.count} pagos`}
      />
      <Row
        label="Tarjeta Bold"
        value={fmt(bold)}
        hint={`${totals_by_method.tarjeta_bold.count} pagos`}
        dim
      />
      <Row
        label="QR Bold"
        value={fmt(qr)}
        hint={`${totals_by_method.qr_bold.count} pagos`}
        dim
      />
      {extras > 0 && (
        <>
          <Divider />
          <Row
            label="Ingresos extra"
            value={fmt(extras)}
            hint="baños, manuales, otros"
            dim
          />
        </>
      )}
      <Divider />
      <Row
        label="Ingreso total del día"
        value={fmt(cashIn + bold + qr + extras)}
        hint="suma de todos los métodos"
        dim
      />
      {expensesTotal > 0 && (
        <>
          <Divider />
          {cashOut > 0 && (
            <Row
              label="Egresos efectivo"
              value={`−${fmt(cashOut)}`}
              hint="restan de la caja física"
              negative
            />
          )}
          {cardOut > 0 && (
            <Row
              label="Egresos tarjeta Bold"
              value={`−${fmt(cardOut)}`}
              hint="restan del neto Bold"
              negative
              dim
            />
          )}
          {qrOut > 0 && (
            <Row
              label="Egresos QR Bold"
              value={`−${fmt(qrOut)}`}
              hint="restan del neto Bold"
              negative
              dim
            />
          )}
          <Row
            label="Egresos total"
            value={`−${fmt(expensesTotal)}`}
            hint={`${detail.expenses_count} ${detail.expenses_count === 1 ? "egreso" : "egresos"}`}
            negative
            dim
          />
        </>
      )}
      <Divider />
      <Row
        label="Esperado en caja"
        value={fmt(expected)}
        hint={cashOut > 0 ? "base + efectivo cobrado − egresos efectivo" : "base + efectivo cobrado"}
        strong
      />
      {(bold > 0 || qr > 0 || cardOut > 0 || qrOut > 0) && (
        <Row
          label="Neto Bold del día"
          value={`${boldNet >= 0 ? "+" : ""}${fmt(boldNet)}`}
          hint="cobros Bold − egresos Bold"
          dim
        />
      )}
      {declared !== null && (
        <Row label="Declarado al cierre" value={fmt(declared)} />
      )}
      {difference !== null && (
        <div
          style={{
            padding: "10px 14px",
            marginTop: 4,
            background:
              Math.abs(difference) < 0.5
                ? C.oliveSoft
                : difference > 0
                  ? C.goldSoft
                  : C.terracottaSoft,
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
            color: C.ink,
          }}
        >
          <span style={{ letterSpacing: 1.5, textTransform: "uppercase" }}>
            Diferencia
          </span>
          <strong>
            {difference >= 0 ? "+" : ""}
            {fmt(difference)}
            {Math.abs(difference) < 0.5
              ? " · cuadra"
              : difference > 0
                ? " · sobra"
                : " · falta"}
          </strong>
        </div>
      )}
      {session.notes && (
        <>
          <Divider />
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: C.cacao,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ color: C.ink }}>Notas:</strong> {session.notes}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
  dim,
  negative,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  dim?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        color: dim ? C.cacao : C.ink,
        opacity: dim ? 0.85 : 1,
      }}
    >
      <span style={{ letterSpacing: 1, textTransform: "uppercase" }}>
        {label}
        {hint && (
          <span
            style={{
              fontSize: 9,
              color: C.mute,
              marginLeft: 6,
              letterSpacing: 0.5,
              textTransform: "none",
            }}
          >
            ({hint})
          </span>
        )}
      </span>
      <strong
        style={{
          fontFamily: strong ? FONT_DISPLAY : FONT_MONO,
          fontSize: strong ? 18 : 13,
          letterSpacing: strong ? 0.5 : 0,
          color: negative ? C.terracotta : undefined,
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: C.sand,
        margin: "2px 0",
      }}
    />
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}
