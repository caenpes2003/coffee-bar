"use client";

import { useEffect, useState } from "react";
import { expensesApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { ExpenseCategory, PaymentMethod } from "@coffee-bar/shared";
import { CancelButton } from "./CancelButton";

/**
 * Modal de registro de gasto (Fase A+ Gastos v1).
 *
 * Usado desde:
 *   - Botón "+ Gasto" del CashRegisterBanner (acceso rápido durante
 *     operación, p. ej. mientras se cobra una mesa).
 *   - Tab "Gastos" en /admin/sales (acceso desde reportería).
 *
 * Reglas:
 *   - Método obligatorio (mismas pills que cobros).
 *   - Categoría obligatoria (radio buttons con los 6 valores enum).
 *   - Concepto obligatorio (>= 3 chars).
 *   - Monto > 0 entero.
 *   - Proveedor, número de recibo y notas opcionales.
 *   - Escape cierra. Click fuera NO cierra (mismo patrón que el resto
 *     de modales contables — un click accidental no debe tirar lo
 *     que escribiste).
 */

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
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

const CATEGORIES: ReadonlyArray<{
  key: ExpenseCategory;
  label: string;
  hint: string;
}> = [
  { key: "mercancia", label: "Mercancía", hint: "Cervezas, licores, mixers" },
  { key: "insumos", label: "Insumos", hint: "Vasos, servilletas, hielo" },
  {
    key: "mantenimiento",
    label: "Mantenimiento",
    hint: "Reparaciones, limpieza",
  },
  {
    key: "servicios",
    label: "Servicios",
    hint: "Luz, agua, internet en el momento",
  },
  {
    key: "personal",
    label: "Personal",
    hint: "Propinas adelantadas, vales",
  },
  { key: "otros", label: "Otros", hint: "Cualquier otro concepto" },
];

export function ExpenseModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [concept, setConcept] = useState("");
  const [supplier, setSupplier] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape cierra. Mismo patrón que los demás modales de jornada.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amountNum = Number(amountStr);
  const amountValid =
    amountStr.trim().length > 0 &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    Number.isInteger(amountNum);
  const conceptValid = concept.trim().length >= 3;
  const canSubmit =
    method !== null && category !== null && amountValid && conceptValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await expensesApi.create({
        method: method!,
        category: category!,
        amount: amountNum,
        concept: concept.trim(),
        supplier: supplier.trim() || undefined,
        receipt_number: receiptNumber.trim() || undefined,
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
    <div
      role="dialog"
      aria-modal
      aria-label="Registrar gasto"
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
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.burgundy,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Registrar gasto
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
            Egreso de caja
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontFamily: FONT_UI,
              fontSize: 12,
              lineHeight: 1.5,
              color: C.cacao,
            }}
          >
            Se descontará del cuadre de la jornada actual según el método
            de pago seleccionado.
          </p>
        </div>

        {/* Monto */}
        <Field label="Monto (COP)">
          <input
            type="number"
            inputMode="numeric"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            disabled={submitting}
            autoFocus
            style={inputStyle}
          />
        </Field>

        {/* Método: en gastos NO distinguimos tarjeta vs QR Bold — el
            proveedor no siempre lo aclara y para el saldo Bold ambos
            netean juntos. Dos opciones: Efectivo / Bold. "Bold" se
            persiste como qr_bold (arbitrario; el backend suma
            tarjeta+qr en un solo neto Bold). */}
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
              display: "block",
              marginBottom: 8,
            }}
          >
            — Método de pago
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {(
              [
                { key: "efectivo", label: "Efectivo" },
                { key: "qr_bold", label: "Bold" },
              ] as { key: PaymentMethod; label: string }[]
            ).map((m) => {
              const selected = method === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  disabled={submitting}
                  aria-pressed={selected}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    background: selected ? C.goldSoft : C.cream,
                    border: `1px solid ${selected ? C.gold : C.sand}`,
                    borderRadius: 10,
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontFamily: FONT_UI,
                    fontSize: 14,
                    fontWeight: 700,
                    color: C.ink,
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Categoría */}
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
              display: "block",
              marginBottom: 8,
            }}
          >
            — Categoría
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            {CATEGORIES.map((c) => {
              const selected = category === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  disabled={submitting}
                  aria-pressed={selected}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: selected ? C.goldSoft : C.cream,
                    border: `1px solid ${selected ? C.gold : C.sand}`,
                    borderRadius: 10,
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontFamily: FONT_UI,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: C.ink,
                      fontSize: 13,
                    }}
                  >
                    {c.label}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 9,
                      letterSpacing: 0.3,
                      color: C.mute,
                    }}
                  >
                    {c.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Concepto */}
        <Field label="Concepto (mín. 3 caracteres)">
          <input
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Ej. Cerveza Aguila x24 al proveedor"
            maxLength={200}
            disabled={submitting}
            style={inputStyle}
          />
        </Field>

        {/* Proveedor + recibo en una fila */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Proveedor (opcional)">
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Ej. Pedro"
              maxLength={120}
              disabled={submitting}
              style={inputStyle}
            />
          </Field>
          <Field label="N° recibo (opcional)">
            <input
              type="text"
              value={receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
              placeholder="Ej. F-1234"
              maxLength={60}
              disabled={submitting}
              style={inputStyle}
            />
          </Field>
        </div>

        {/* Notas */}
        <Field label="Notas (opcional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={submitting}
            placeholder="Detalle adicional"
            style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
          />
        </Field>

        {error && (
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
              background: canSubmit ? C.burgundy : C.mute,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {submitting ? "Registrando…" : "Registrar gasto"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers internos ─────────────────────────────────────────────────────

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

export { CATEGORIES as EXPENSE_CATEGORIES };
