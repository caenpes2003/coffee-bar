"use client";

import { useCallback, useEffect, useState } from "react";
import { cashRegisterApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type {
  CashRegisterSession,
  CashRegisterSessionDetail,
} from "@coffee-bar/shared";
import { CancelButton } from "./CancelButton";

/**
 * Banner global de estado del día contable (Fase A+ B3).
 *
 * Visible en todas las páginas admin autenticadas. Muestra:
 *
 *   - Si NO hay día abierto: barra roja sticky en el TOP con CTA
 *     "Abrir jornada" → modal con base inicial + bypass opcional.
 *   - Si hay día abierto: pill discreta en el TOP-RIGHT mostrando
 *     "Jornada abierta · base $X · hace Y" + botón "Cerrar jornada".
 *
 * El cierre dispara un modal-ticket que muestra:
 *   - opening_balance
 *   - cobros por método (efectivo / tarjeta Bold / QR Bold)
 *   - expected = opening + efectivo cobrado
 *   - input para closing_balance_declared
 *   - difference = declared - expected (preview en vivo)
 *
 * Polling: cada 30s + on-focus. Suficiente para coherencia operativa
 * (el cajero ve un cambio dentro de 30s si otro device abrió/cerró
 * día). El refetch tras open/close es inmediato.
 */

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-manrope)";
const FONT_UI = "var(--font-manrope)";

const POLL_INTERVAL_MS = 30_000;

export function CashRegisterBanner() {
  const [session, setSession] = useState<CashRegisterSession | null | "loading">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openModalShown, setOpenModalShown] = useState(false);
  const [closeModalShown, setCloseModalShown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { session } = await cashRegisterApi.current();
      setSession(session);
      setLoadError(null);
    } catch (err) {
      // Si el endpoint mismo falla (ej: 500), mostramos pill amarilla
      // y no bloqueamos al cajero — mejor degradado que indefinido.
      setLoadError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // ─── Cargando inicial: nada, evitar parpadeo ────────────────────
  if (session === "loading") return null;

  // ─── Error de red: barra amarilla discreta ──────────────────────
  if (loadError) {
    return (
      <div
        role="status"
        style={{
          background: C.goldSoft,
          color: C.cacao,
          padding: "6px 16px",
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        No se pudo verificar el estado del día. Reintentando…
      </div>
    );
  }

  // ─── NO HAY DÍA ABIERTO: banner rojo bloqueante ─────────────────
  if (session === null) {
    return (
      <>
        <div
          role="alert"
          style={{
            background: C.burgundy,
            color: C.paper,
            padding: "14px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            zIndex: 60,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 18,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              No hay jornada de caja abierta
            </strong>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1,
                opacity: 0.9,
              }}
            >
              Los cobros, pedidos y aperturas de mesa están bloqueados
              hasta que se abra la jornada.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpenModalShown(true)}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: C.paper,
              color: C.burgundy,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Abrir jornada
          </button>
        </div>
        {openModalShown && (
          <OpenDayModal
            onClose={() => setOpenModalShown(false)}
            onDone={() => {
              setOpenModalShown(false);
              void refresh();
            }}
          />
        )}
      </>
    );
  }

  // ─── HAY DÍA ABIERTO: pill discreta + botón cerrar ──────────────
  return (
    <>
      <div
        style={{
          background: session.opened_via_bypass ? C.goldSoft : C.oliveSoft,
          color: C.ink,
          padding: "8px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: `1px solid ${C.sand}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: C.cacao,
              fontWeight: 700,
            }}
          >
            ● Jornada abierta
          </span>
          <span
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: C.cacao,
            }}
          >
            Base{" "}
            <strong style={{ color: C.ink }}>
              {fmtCOP(Number(session.opening_balance))}
            </strong>{" "}
            · desde {fmtRelative(session.opened_at)}
          </span>
          {session.opened_via_bypass && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: C.burgundy,
                background: C.burgundySoft,
                padding: "2px 8px",
                borderRadius: 6,
                fontWeight: 700,
              }}
              title={session.opened_bypass_reason ?? ""}
            >
              ⚠ Apertura excepcional
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCloseModalShown(true)}
          style={{
            padding: "6px 16px",
            border: `1px solid ${C.burgundy}`,
            borderRadius: 999,
            background: "transparent",
            color: C.burgundy,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            cursor: "pointer",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Cerrar jornada
        </button>
      </div>
      {closeModalShown && (
        <CloseDayModal
          sessionId={session.id}
          onClose={() => setCloseModalShown(false)}
          onDone={() => {
            setCloseModalShown(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal abrir día
// ───────────────────────────────────────────────────────────────────────────

function OpenDayModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [openingStr, setOpeningStr] = useState("");
  const [notes, setNotes] = useState("");
  const [bypass, setBypass] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openingNum = Number(openingStr);
  const openingValid =
    openingStr.trim().length > 0 &&
    Number.isFinite(openingNum) &&
    openingNum >= 0;
  const bypassValid = bypass ? bypassReason.trim().length >= 3 : true;
  const canSubmit = openingValid && bypassValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await cashRegisterApi.open({
        opening_balance: openingNum,
        bypass: bypass || undefined,
        bypass_reason: bypass ? bypassReason.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell onCancel={onClose} title="Abrir jornada" eyebrow="— Apertura de caja">
      <p
        style={{
          margin: 0,
          fontFamily: FONT_UI,
          fontSize: 13,
          color: C.cacao,
          lineHeight: 1.5,
        }}
      >
        Realice el conteo físico del dinero disponible en la caja en este
        momento (efectivo para vueltos más cualquier saldo previo). Este
        valor servirá como base para verificar el cuadre al cierre de la
        jornada.
      </p>

      <label style={labelStyle}>
        <span style={labelTextStyle}>Base inicial (COP)</span>
        <input
          type="number"
          inputMode="numeric"
          value={openingStr}
          onChange={(e) => setOpeningStr(e.target.value)}
          placeholder="0"
          style={inputStyle}
          autoFocus
        />
      </label>

      <label style={labelStyle}>
        <span style={labelTextStyle}>Notas (opcional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Ej: cambio en billetes chicos + monedas"
          style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
        />
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          border: `1px solid ${C.sand}`,
          borderRadius: 10,
          background: C.cream,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={bypass}
          onChange={(e) => setBypass(e.target.checked)}
          style={{ marginTop: 2, cursor: "pointer" }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.ink,
              fontWeight: 600,
            }}
          >
            Apertura excepcional
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 0.5,
              color: C.mute,
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            Active esta opción únicamente si no es posible verificar la
            base en este momento. La sesión quedará marcada como
            apertura excepcional en el reporte de cierre.
          </div>
        </div>
      </label>

      {bypass && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>
            Motivo de la apertura excepcional (obligatorio, mín. 3
            caracteres)
          </span>
          <input
            type="text"
            value={bypassReason}
            onChange={(e) => setBypassReason(e.target.value)}
            placeholder="Ej. urgencia operativa, sin tiempo para conteo"
            maxLength={200}
            style={inputStyle}
          />
        </label>
      )}

      {error && <ErrorRow message={error} />}

      <ModalActions
        cancelLabel="Cancelar"
        confirmLabel={submitting ? "Abriendo..." : "Abrir jornada"}
        canSubmit={canSubmit}
        busy={submitting}
        onCancel={onClose}
        onConfirm={submit}
        confirmTone="olive"
      />
    </ModalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal cerrar día (ticket de cierre)
// ───────────────────────────────────────────────────────────────────────────

function CloseDayModal({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [detail, setDetail] = useState<CashRegisterSessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [declaredStr, setDeclaredStr] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    cashRegisterApi
      .detail(sessionId)
      .then(setDetail)
      .catch((err: unknown) => setLoadError(getErrorMessage(err)));
  }, [sessionId]);

  const opening = detail ? Number(detail.session.opening_balance) : 0;
  const cashIn = detail?.totals_by_method.efectivo.amount ?? 0;
  const expected = opening + cashIn;
  const declaredNum = Number(declaredStr);
  const declaredValid =
    declaredStr.trim().length > 0 &&
    Number.isFinite(declaredNum) &&
    declaredNum >= 0;
  const difference = declaredValid ? declaredNum - expected : 0;
  const canSubmit = declaredValid && !submitting && detail !== null;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await cashRegisterApi.close({
        closing_balance_declared: declaredNum,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      onCancel={onClose}
      title="Cerrar jornada"
      eyebrow="— Cierre de caja"
      maxWidth={520}
    >
      {loadError && <ErrorRow message={loadError} />}

      {!detail && !loadError && (
        <p
          style={{
            margin: 0,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          Cargando totales del día…
        </p>
      )}

      {detail && (
        <>
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
            <TicketRow label="Base de apertura" value={fmtCOP(opening)} />
            <Divider />
            <TicketRow
              label="Efectivo cobrado"
              value={fmtCOP(cashIn)}
              hint={`${detail.totals_by_method.efectivo.count} pagos`}
            />
            <TicketRow
              label="Tarjeta Bold"
              value={fmtCOP(detail.totals_by_method.tarjeta_bold.amount)}
              hint={`${detail.totals_by_method.tarjeta_bold.count} pagos`}
              dim
            />
            <TicketRow
              label="QR Bold"
              value={fmtCOP(detail.totals_by_method.qr_bold.amount)}
              hint={`${detail.totals_by_method.qr_bold.count} pagos`}
              dim
            />
            {(detail.extra_income_total > 0 ||
              detail.luggage_total > 0) && <Divider />}
            {detail.extra_income_total > 0 && (
              <TicketRow
                label="Ingresos extra"
                value={fmtCOP(detail.extra_income_total)}
                dim
              />
            )}
            {detail.luggage_total > 0 && (
              <TicketRow
                label="Guardarropa"
                value={fmtCOP(detail.luggage_total)}
                dim
              />
            )}
            <Divider />
            <TicketRow
              label="Ingreso total del día"
              value={fmtCOP(
                cashIn +
                  detail.totals_by_method.tarjeta_bold.amount +
                  detail.totals_by_method.qr_bold.amount +
                  detail.extra_income_total +
                  detail.luggage_total,
              )}
              hint="suma de todos los métodos"
              dim
            />
            <Divider />
            <TicketRow
              label="Esperado en caja"
              value={fmtCOP(expected)}
              strong
              hint="base + efectivo cobrado"
            />
          </div>

          <label style={labelStyle}>
            <span style={labelTextStyle}>
              Plata real en caja (contada ahora)
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={declaredStr}
              onChange={(e) => setDeclaredStr(e.target.value)}
              placeholder="0"
              style={inputStyle}
              autoFocus
            />
          </label>

          {declaredValid && (
            <div
              style={{
                padding: "10px 14px",
                background:
                  Math.abs(difference) < 0.5
                    ? C.oliveSoft
                    : difference > 0
                      ? C.goldSoft
                      : C.burgundySoft,
                borderRadius: 8,
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.ink,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ letterSpacing: 1.5, textTransform: "uppercase" }}>
                Diferencia
              </span>
              <strong>
                {difference >= 0 ? "+" : ""}
                {fmtCOP(difference)}
                {Math.abs(difference) < 0.5
                  ? " · cuadra"
                  : difference > 0
                    ? " · sobra"
                    : " · falta"}
              </strong>
            </div>
          )}

          <label style={labelStyle}>
            <span style={labelTextStyle}>Notas del cierre (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ej: faltó cambio para vuelto, propina apartada, etc."
              style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
            />
          </label>

          {submitError && <ErrorRow message={submitError} />}

          <ModalActions
            cancelLabel="Cancelar"
            confirmLabel={submitting ? "Cerrando..." : "Confirmar cierre"}
            canSubmit={canSubmit}
            busy={submitting}
            onCancel={onClose}
            onConfirm={submit}
            confirmTone="burgundy"
          />
        </>
      )}
    </ModalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers compartidos (estilos + sub-componentes)
// ───────────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const labelTextStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 8,
  fontFamily: FONT_MONO,
  fontSize: 13,
  background: C.cream,
  color: C.ink,
  outline: "none",
};

function ModalShell({
  children,
  title,
  eyebrow,
  onCancel,
  maxWidth = 460,
}: {
  children: React.ReactNode;
  title: string;
  eyebrow: string;
  onCancel: () => void;
  maxWidth?: number;
}) {
  // Escape cierra el modal. Click fuera NO cierra — caja contable es
  // crítica y un click accidental en el overlay puede tirar la
  // declaración a medio escribir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
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
          maxWidth,
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
        <div>
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
            {eyebrow}
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "4px 0 0",
            }}
          >
            {title}
          </h3>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  cancelLabel,
  confirmLabel,
  canSubmit,
  busy,
  onCancel,
  onConfirm,
  confirmTone,
}: {
  cancelLabel: string;
  confirmLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmTone: "olive" | "burgundy";
}) {
  const accent = confirmTone === "olive" ? C.olive : C.burgundy;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        justifyContent: "flex-end",
        marginTop: 6,
      }}
    >
      <CancelButton label={cancelLabel} onClick={onCancel} busy={busy} />
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canSubmit}
        style={{
          padding: "10px 22px",
          border: "none",
          borderRadius: 999,
          background: canSubmit ? accent : C.mute,
          color: C.paper,
          fontFamily: FONT_DISPLAY,
          fontSize: 13,
          letterSpacing: 2.5,
          cursor: canSubmit ? "pointer" : "not-allowed",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        padding: 10,
        background: C.burgundySoft,
        color: C.burgundy,
        borderRadius: 8,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
      }}
    >
      {message}
    </p>
  );
}

function TicketRow({
  label,
  value,
  hint,
  strong,
  dim,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  dim?: boolean;
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

function fmtCOP(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}
