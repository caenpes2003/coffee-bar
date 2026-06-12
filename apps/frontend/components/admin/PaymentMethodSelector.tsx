"use client";

import type { PaymentMethod } from "@coffee-bar/shared";

/**
 * Selector visual de método de pago (Fase A+ B3).
 *
 * Pieza reusable usada por:
 *   - Modal de pago parcial (AdminBillDrawer / ActionModal)
 *   - Modal de "cobrar y cerrar" (AdminBillDrawer / mark-paid flow)
 *   - Eventualmente cobros divididos: el caller usa N selectores en
 *     paralelo o un selector + cantidad por método.
 *
 * Diseño:
 *   - Tres pills visuales, una por método (efectivo / tarjeta Bold / QR Bold).
 *   - Selección obligatoria — `value` puede ser `null` para forzar al
 *     usuario a elegir antes de habilitar el botón de confirmar.
 *   - Estilo coherente con AdminBillDrawer (mismas paletas/fuentes,
 *     todo inline-style para no agregar nuevas dependencias).
 *
 * NO incluye monto: el caller maneja el input de cantidad. Esta pieza
 * solo trafica con el método.
 */

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  ink: "#2B1D14",
  mute: "#A89883",
};

const FONT_MONO = "var(--font-manrope)";
const FONT_UI = "var(--font-manrope)";

const METHODS: ReadonlyArray<{
  key: PaymentMethod;
  label: string;
  hint: string;
}> = [
  { key: "efectivo", label: "Efectivo", hint: "Cuenta para el cierre de caja" },
  {
    key: "tarjeta_bold",
    label: "Tarjeta Bold",
    hint: "Pasa al consolidado Bold",
  },
  { key: "qr_bold", label: "QR Bold", hint: "Pasa al consolidado Bold" },
];

export function PaymentMethodSelector({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: PaymentMethod | null;
  onChange: (next: PaymentMethod) => void;
  disabled?: boolean;
  /**
   * Variante compacta para cobros divididos: pills horizontales,
   * sin label arriba ni hint debajo del método. Usado cuando se
   * apilan N filas { método + monto } dentro del mismo modal y la
   * variante grande ocuparía demasiado vertical.
   */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {METHODS.map((m) => {
          const selected = value === m.key;
          return (
            <button
              key={m.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(m.key)}
              aria-pressed={selected}
              style={{
                padding: "6px 12px",
                background: selected ? C.goldSoft : C.cream,
                border: `1px solid ${selected ? C.gold : C.sand}`,
                borderRadius: 999,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                transition:
                  "background 120ms ease, border-color 120ms ease",
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                color: selected ? C.ink : C.mute,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
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
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {METHODS.map((m) => {
          const selected = value === m.key;
          return (
            <button
              key={m.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(m.key)}
              aria-pressed={selected}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 14px",
                background: selected ? C.goldSoft : C.cream,
                border: `1px solid ${selected ? C.gold : C.sand}`,
                borderRadius: 10,
                textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                transition:
                  "background 120ms ease, border-color 120ms ease",
                fontFamily: FONT_UI,
              }}
            >
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontWeight: 700,
                    color: C.ink,
                    fontSize: 14,
                  }}
                >
                  {m.label}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 0.5,
                    color: C.mute,
                    marginTop: 2,
                  }}
                >
                  {m.hint}
                </span>
              </span>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: `2px solid ${selected ? C.gold : C.sandDark}`,
                  background: selected ? C.gold : "transparent",
                  marginTop: 4,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
