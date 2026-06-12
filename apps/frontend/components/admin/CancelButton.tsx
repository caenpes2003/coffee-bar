"use client";

import { useState } from "react";

/**
 * Botón "Cancelar" reusable para modales del admin.
 *
 * Estados visuales:
 *   - Reposo: outline sand, texto cacao.
 *   - Hover: fondo burgundy con texto blanco (advertencia suave —
 *     cancelar es una acción destructiva del intento).
 *   - Disabled (busy): opacidad reducida, sin hover.
 *
 * Como el resto del admin usa inline-styles (no CSS modules), el
 * hover se maneja con state local — patrón consistente con la
 * implementación del resto del repo.
 */

const C = {
  sand: "#F1E6D2",
  burgundy: "#8B2635",
  paper: "#FFFDF8",
  cacao: "#6B4E2E",
};

const FONT_MONO = "var(--font-manrope)";

export function CancelButton({
  label = "Cancelar",
  onClick,
  busy = false,
  style,
}: {
  label?: string;
  onClick: () => void;
  busy?: boolean;
  /**
   * Style override aditivo. Útil cuando el botón vive dentro de un
   * row con `flex: 1` u otras restricciones de layout que el caller
   * necesita preservar (p. ej. VoidReasonModal).
   */
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const active = hover && !busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "10px 18px",
        border: `1px solid ${active ? C.burgundy : C.sand}`,
        background: active ? C.burgundy : "transparent",
        color: active ? C.paper : C.cacao,
        borderRadius: 999,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 2,
        cursor: busy ? "not-allowed" : "pointer",
        textTransform: "uppercase",
        opacity: busy ? 0.5 : 1,
        transition:
          "background 120ms ease, color 120ms ease, border-color 120ms ease",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
