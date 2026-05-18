"use client";

import { useEffect } from "react";

/**
 * Cierra un modal/drawer corto al presionar Escape. Se usa SOLO en
 * modales cortos donde el riesgo de perder datos por accidente es bajo
 * (LuggageNewModal, ReasonModal, etc.). En drawers grandes con
 * formularios extensos (AdminBillDrawer, ProductDetailPanel) NO se
 * registra: el operador puede teclear Esc dentro de un input por
 * error y perder cambios sin guardar.
 *
 * Si `enabled` es false (default true), no se registra el listener —
 * útil para condicionarlo a `open` sin desmontar el componente.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onEscape]);
}
