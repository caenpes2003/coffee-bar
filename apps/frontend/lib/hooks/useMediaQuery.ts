"use client";

import { useSyncExternalStore } from "react";

/**
 * Hook de media query para adaptar layouts desktop-first a móvil.
 *
 * Implementado con useSyncExternalStore para que:
 *   - En SSR devuelva SIEMPRE `false` (server no conoce el viewport;
 *     desktop-first significa que el markup del server es el desktop).
 *   - En el cliente se corrija sincrónicamente en el primer render
 *     post-hidratación, sin flash perceptible ni warning de mismatch.
 *   - Cambios de viewport (rotación, resize) re-rendericen en vivo.
 *
 * Uso típico:
 *   const isMobile = useIsMobile();
 *   <div style={{ flexDirection: isMobile ? "column" : "row" }}>
 *
 * Para tweaks de CSS puros (padding, tamaños) preferir <style> con
 * @media + className — no re-renderiza React y evita depender del JS
 * (patrón ya usado en AdminPlaybackPlayer). Este hook es para cambios
 * ESTRUCTURALES que requieren lógica (qué componente montar, cuántas
 * columnas pasar por props, etc.).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    // Server snapshot: siempre desktop (false).
    () => false,
  );
}

/**
 * Breakpoint estándar del admin: móvil = < 768px.
 *
 * 768 y no 640 porque el dashboard tiene paneles laterales que ya no
 * caben cómodos en tablets pequeñas en portrait — mejor colapsar a
 * layout móvil también ahí.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
