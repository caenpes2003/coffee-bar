"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { barBalanceApi, type BarBalance } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt } from "@/lib/theme";
import { CancelButton } from "./CancelButton";

/**
 * Tile "Saldo del bar" para el header del dashboard.
 *
 * Comportamiento:
 *   - Por defecto muestra "••••••" (oculto). El botón de ojo revela
 *     el saldo real (efectivo + Bold) — se re-fetchea en cada reveal
 *     para que siempre esté al día.
 *   - El valor NO parece editable. La edición se activa con un gesto
 *     discreto: 5 taps rápidos (ventana de 2.5s) sobre el área del
 *     valor. Eso abre un modal que pide un código de autorización
 *     (validado server-side) + los nuevos valores.
 *   - El saldo mostrado es DERIVADO: línea base manual + los deltas
 *     de cada cierre de jornada posterior (efectivo: declarado−base;
 *     Bold: cobros−egresos). Corregirlo = fijar nueva línea base.
 */

const TAP_WINDOW_MS = 2_500;
const TAPS_REQUIRED = 5;

export function BarBalanceTile() {
  const [revealed, setRevealed] = useState(false);
  // Segundo nivel de revelado: el desglose efectivo/bold. Por defecto,
  // al revelar solo se ve el TOTAL; el desglose se pide aparte.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [balance, setBalance] = useState<BarBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // Contador del gesto secreto. Se resetea si pasan >2.5s desde el
  // primer tap de la ráfaga.
  const tapsRef = useRef<{ count: number; firstAt: number }>({
    count: 0,
    firstAt: 0,
  });

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    try {
      const data = await barBalanceApi.get();
      setBalance(data);
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // El saldo del bar SOLO cambia al cerrar una jornada (cada venta
  // suelta no lo mueve — entra al saldo cuando la jornada cierra). Por
  // eso el único auto-refresh es el evento `crown:day-closed` que emite
  // el CloseDayModal. Si el saldo está revelado, refrescamos el número
  // en vivo; si está oculto, no hace falta (el próximo reveal ya
  // re-fetchea).
  useEffect(() => {
    const onDayClosed = () => {
      if (revealed) void fetchBalance();
    };
    window.addEventListener("crown:day-closed", onDayClosed);
    return () => window.removeEventListener("crown:day-closed", onDayClosed);
  }, [revealed, fetchBalance]);

  const toggleReveal = () => {
    const next = !revealed;
    setRevealed(next);
    // Al ocultar, colapsar también el desglose para que el próximo
    // reveal vuelva a arrancar en "solo total".
    if (!next) setShowBreakdown(false);
    if (next) void fetchBalance();
  };

  const onSecretTap = () => {
    const now = Date.now();
    const t = tapsRef.current;
    if (now - t.firstAt > TAP_WINDOW_MS) {
      t.count = 1;
      t.firstAt = now;
    } else {
      t.count += 1;
    }
    if (t.count >= TAPS_REQUIRED) {
      t.count = 0;
      t.firstAt = 0;
      setEditOpen(true);
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          background: C.cream,
          border: `1px solid ${C.sand}`,
          borderRadius: 10,
          minWidth: 0,
        }}
      >
        <div
          // Área del gesto secreto: el label + valor. El handler NO
          // está en el botón del ojo para que revelar/ocultar no
          // cuente como taps.
          onClick={onSecretTap}
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            cursor: "default",
            userSelect: "none",
          }}
        >
          <span
            onClick={(e) => {
              // Si el desglose está abierto, este click lo colapsa
              // (sin propagar al gesto secreto). Si no, deja pasar el
              // tap para el contador del gesto.
              if (revealed && showBreakdown) {
                e.stopPropagation();
                setShowBreakdown(false);
              }
            }}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 1.5,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Saldo del bar
            {revealed && showBreakdown && (
              <span style={{ color: C.gold, marginLeft: 6 }}>▾</span>
            )}
          </span>
          {revealed && balance ? (
            balance.configured ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {/* Nivel 1: total (efectivo + bold). Es lo primero que
                    se ve al revelar. */}
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 17,
                    color: C.ink,
                    letterSpacing: 0.5,
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmt(balance.cash + balance.bold)}
                </span>
                {/* Nivel 2: desglose, escondido tras un toggle propio
                    (no cuenta como tap del gesto secreto: su onClick
                    frena la propagación). */}
                {showBreakdown ? (
                  <span
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 11,
                      color: C.cacao,
                      whiteSpace: "nowrap",
                      marginTop: 1,
                    }}
                  >
                    {fmt(balance.cash)}{" "}
                    <span style={{ color: C.mute, fontSize: 9 }}>efectivo</span>
                    {" · "}
                    {fmt(balance.bold)}{" "}
                    <span style={{ color: C.mute, fontSize: 9 }}>bold</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowBreakdown(true);
                    }}
                    style={{
                      alignSelf: "flex-start",
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      marginTop: 1,
                      cursor: "pointer",
                      fontFamily: FONT_MONO,
                      fontSize: 9,
                      letterSpacing: 1,
                      color: C.gold,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    Ver desglose ▸
                  </button>
                )}
              </div>
            ) : (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.mute,
                  letterSpacing: 1,
                }}
              >
                Sin configurar
              </span>
            )
          ) : (
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 16,
                color: C.mute,
                letterSpacing: 3,
                lineHeight: 1,
              }}
            >
              {loading ? "···" : "••••••"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleReveal}
          aria-label={revealed ? "Ocultar saldo" : "Mostrar saldo"}
          title={revealed ? "Ocultar" : "Mostrar"}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
            color: C.cacao,
            flexShrink: 0,
          }}
        >
          <EyeIcon open={revealed} />
        </button>
      </div>

      {editOpen && (
        <BarBalanceEditModal
          current={balance}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false);
            // Refrescar y revelar para confirmar visualmente el cambio.
            setRevealed(true);
            void fetchBalance();
          }}
        />
      )}
    </>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  // Ojo simple en SVG inline (sin dependencias). Abierto vs tachado.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
      {open && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

// ─── Modal de edición (tras el gesto secreto) ──────────────────────────────

function BarBalanceEditModal({
  current,
  onClose,
  onDone,
}: {
  current: BarBalance | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [cashStr, setCashStr] = useState(
    current?.configured ? String(Math.round(current.cash)) : "",
  );
  const [boldStr, setBoldStr] = useState(
    current?.configured ? String(Math.round(current.bold)) : "",
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cashNum = Number(cashStr);
  const boldNum = Number(boldStr);
  const valid =
    code.trim().length > 0 &&
    cashStr.trim().length > 0 &&
    boldStr.trim().length > 0 &&
    Number.isInteger(cashNum) &&
    Number.isInteger(boldNum) &&
    cashNum >= 0 &&
    boldNum >= 0;
  const canSubmit = valid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await barBalanceApi.set({
        code: code.trim(),
        cash_amount: cashNum,
        bold_amount: boldNum,
        note: note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Ajustar saldo del bar"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 95,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
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
            — Ajuste de saldo
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
            Saldo del bar
          </h3>
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: FONT_UI,
              fontSize: 12,
              lineHeight: 1.5,
              color: C.cacao,
            }}
          >
            Fija la línea base del saldo. A partir de aquí el valor se
            actualiza solo con cada cierre de jornada. La corrección
            queda registrada con tu usuario y fecha.
          </p>
        </div>

        <Field label="Código de autorización">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="••••"
            maxLength={20}
            disabled={submitting}
            autoFocus
            style={inputStyle}
          />
        </Field>

        <Field label="Efectivo en el bar (COP)">
          <input
            type="number"
            inputMode="numeric"
            value={cashStr}
            onChange={(e) => setCashStr(e.target.value)}
            placeholder="0"
            disabled={submitting}
            style={inputStyle}
          />
        </Field>

        <Field label="Saldo Bold (COP)">
          <input
            type="number"
            inputMode="numeric"
            value={boldStr}
            onChange={(e) => setBoldStr(e.target.value)}
            placeholder="0"
            disabled={submitting}
            style={inputStyle}
          />
        </Field>

        <Field label="Nota (opcional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. conteo físico del 7 de julio"
            maxLength={300}
            disabled={submitting}
            style={inputStyle}
          />
        </Field>

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
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 6,
          }}
        >
          <CancelButton onClick={onClose} busy={submitting} />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit ? C.ink : C.mute,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {submitting ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 8,
  fontFamily: FONT_MONO,
  fontSize: 13,
  background: C.cream,
  color: C.ink,
  outline: "none",
  width: "100%",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
