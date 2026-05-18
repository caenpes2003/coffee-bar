"use client";

/**
 * Modal de "Otro ingreso" — registra un ingreso extra puntual con
 * concepto + monto libres (ej. bodegaje, rentas eventuales). NO usa
 * catálogo de productos: vive en ExtraIncome.type='manual'.
 *
 * Diseño:
 *   - Concepto: input de texto obligatorio (mínimo 3, máximo 120).
 *   - Monto: input numérico entero positivo.
 *   - Notas: opcional.
 *
 * Cierra con click-fuera, Esc, o Cancelar. Mientras está enviando, los
 * tres caminos quedan bloqueados para no descartar la operación.
 */

import { useState } from "react";
import { extraIncomeApi, type ExtraIncomeApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useEscapeKey } from "@/lib/hooks/useEscapeKey";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt } from "@/lib/theme";

export function ManualIncomeModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (entry: ExtraIncomeApi) => void;
}) {
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onCancel, !submitting);

  const parsedAmount = Number(amount);
  const conceptOk = concept.trim().length >= 3;
  const amountOk =
    Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount < 100_000_000;
  const canSubmit = conceptOk && amountOk && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await extraIncomeApi.createManual({
        concept: concept.trim(),
        amount: parsedAmount,
        notes: notes.trim() || undefined,
      });
      onCreated(created);
    } catch (e) {
      setError(getErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Otro ingreso"
      onClick={() => {
        if (!submitting) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 95,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: C.paper,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.55)",
        }}
      >
        <header
          style={{
            padding: "16px 22px 12px",
            borderBottom: `1px solid ${C.sand}`,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            — Ingreso extra
          </span>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              letterSpacing: 1,
              color: C.ink,
              margin: "4px 0 0",
              lineHeight: 1.1,
              textTransform: "uppercase",
            }}
          >
            Otro ingreso
          </h2>
        </header>

        <div
          style={{
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <section>
            <Label>Concepto</Label>
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder='Ej. "Bodega de carpas - Cliente X"'
              maxLength={120}
              autoFocus
              style={inputStyle()}
            />
            {!conceptOk && concept.length > 0 && (
              <Hint tone="alert">Mínimo 3 caracteres</Hint>
            )}
          </section>

          <section>
            <Label>Monto</Label>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontFamily: FONT_DISPLAY,
                  fontSize: 18,
                  color: C.cacao,
                  pointerEvents: "none",
                }}
              >
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
                style={{ ...inputStyle(), paddingLeft: 28 }}
              />
            </div>
            {amountOk && (
              <Hint>{fmt(parsedAmount)}</Hint>
            )}
            {amount.length > 0 && !amountOk && (
              <Hint tone="alert">
                Monto debe ser un entero positivo
              </Hint>
            )}
          </section>

          <section>
            <Label>Notas (opcional)</Label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalle interno"
              maxLength={200}
              style={inputStyle()}
            />
          </section>

          {error && (
            <div
              role="alert"
              style={{
                padding: 10,
                borderRadius: 8,
                background: C.terracottaSoft,
                color: C.terracotta,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 0.5,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <footer
          style={{
            padding: "12px 22px 18px",
            borderTop: `1px solid ${C.sand}`,
            background: C.cream,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "10px 18px",
              border: `1px solid ${C.sand}`,
              background: "transparent",
              color: C.cacao,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              cursor: submitting ? "wait" : "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit
                ? `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`
                : C.sand,
              color: canSubmit ? C.paper : C.mute,
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {submitting ? "Guardando..." : "Registrar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 2,
        color: C.cacao,
        textTransform: "uppercase",
        fontWeight: 700,
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

function Hint({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "alert";
}) {
  return (
    <div
      style={{
        marginTop: 4,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 0.5,
        color: tone === "alert" ? C.terracotta : C.mute,
      }}
    >
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${C.sand}`,
    borderRadius: 10,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT_UI,
    fontSize: 14,
    outline: "none",
  };
}
