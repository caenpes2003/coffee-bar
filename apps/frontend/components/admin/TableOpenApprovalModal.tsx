"use client";

/**
 * Modal de autorización de apertura de mesa (F3).
 *
 * Un cliente escaneó el QR de una mesa CERRADA e ingresó el código del
 * bar correcto (validado server-side). La solicitud queda pending y
 * este modal aparece en el dashboard: "Autorizar apertura mesa 0X".
 *
 *   - Aceptar → el backend crea la sesión; el cliente entra solo (su
 *     dispositivo reclama el resultado por HTTP).
 *   - Rechazar → el cliente ve el rechazo y vuelve al formulario.
 *   - Sin respuesta en 2 min → expira sola (el countdown lo muestra).
 *
 * Se hidrata con listPending al montar (recargas de página) y vive de
 * los sockets table-open-request:created/resolved — el resolved
 * también quita el modal en OTRAS pestañas admin abiertas.
 */

import { useCallback, useEffect, useState } from "react";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tableOpenRequestsApi,
  type TableOpenRequestPending,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI } from "@/lib/theme";

export function TableOpenApprovalModal() {
  const [requests, setRequests] = useState<TableOpenRequestPending[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tick para countdown y para descartar solicitudes ya vencidas.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    tableOpenRequestsApi
      .listPending()
      .then(setRequests)
      .catch((e: unknown) =>
        console.error("[TableOpenApproval] listPending", e),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket({
    staff: true,
    onTableOpenRequestCreated: (payload) => {
      setRequests((prev) =>
        prev.some((r) => r.id === payload.id) ? prev : [...prev, payload],
      );
    },
    onTableOpenRequestResolved: (payload) => {
      // Resuelta acá o en otra pestaña: fuera de la lista.
      setRequests((prev) => prev.filter((r) => r.id !== payload.id));
    },
  });

  const act = async (id: number, action: "approve" | "reject") => {
    if (busyId != null) return;
    setBusyId(id);
    setError(null);
    try {
      if (action === "approve") await tableOpenRequestsApi.approve(id);
      else await tableOpenRequestsApi.reject(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      if (code === "TABLE_OPEN_REQUEST_NOT_PENDING") {
        // Otro admin la resolvió o expiró — solo quitarla.
        setRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setError(getErrorMessage(e));
      }
    } finally {
      setBusyId(null);
    }
  };

  const alive = requests.filter(
    (r) => new Date(r.expires_at).getTime() > now,
  );
  if (alive.length === 0) return null;

  const current = alive[0];
  const remainingSec = Math.max(
    0,
    Math.floor((new Date(current.expires_at).getTime() - now) / 1000),
  );

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Autorizar apertura de mesa"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 120,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.paper,
          borderRadius: 16,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.55)",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 3,
            color: C.gold,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          — Solicitud de apertura
        </span>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 26,
            letterSpacing: 1,
            color: C.ink,
            margin: 0,
            textTransform: "uppercase",
            lineHeight: 1.15,
          }}
        >
          Autorizar apertura
          <br />
          mesa {String(current.table_number).padStart(2, "0")}
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 13.5,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          Un cliente escaneó el QR e ingresó el código del bar correcto.
          ¿Abrir la mesa?
        </p>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            letterSpacing: 2,
            color: remainingSec <= 20 ? C.terracotta : C.mute,
          }}
        >
          Expira en {Math.floor(remainingSec / 60)}:
          {String(remainingSec % 60).padStart(2, "0")}
        </span>
        {alive.length > 1 && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 1.5,
              color: C.mute,
              textTransform: "uppercase",
            }}
          >
            +{alive.length - 1} solicitud(es) más en cola
          </span>
        )}
        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.terracotta,
              letterSpacing: 1,
            }}
          >
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => void act(current.id, "reject")}
            disabled={busyId != null}
            style={{
              flex: 1,
              padding: "12px 16px",
              border: `1px solid ${C.terracotta}`,
              background: "transparent",
              color: C.terracotta,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              cursor: busyId != null ? "wait" : "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => void act(current.id, "approve")}
            disabled={busyId != null}
            style={{
              flex: 1,
              padding: "12px 16px",
              border: "none",
              borderRadius: 999,
              background:
                busyId != null
                  ? C.sand
                  : `linear-gradient(135deg, ${C.olive} 0%, #7E8F58 100%)`,
              color: busyId != null ? C.mute : C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              letterSpacing: 2.5,
              cursor: busyId != null ? "wait" : "pointer",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {busyId === current.id ? "..." : "Autorizar"}
          </button>
        </div>
      </div>
    </div>
  );
}
