"use client";

import { useEffect, useState } from "react";
import { tablesApi, tableSessionsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, pad } from "@/lib/theme";
import type { Table } from "@coffee-bar/shared";
import { CancelButton } from "./CancelButton";

/**
 * Modal: transferir la cuenta completa a otra mesa/barra.
 *
 * Los clientes se cambiaron de sitio y la cuenta los sigue. Destinos:
 *   - Mesas físicas LIBRES (sin sesión activa).
 *   - "Barra nueva…" con nombre obligatorio (se crea la barra virtual
 *     en el mismo paso, patrón walk-in).
 *
 * La transferencia mueve TODO: consumos, pedidos, pagos y canciones.
 * Si el destino se ocupa entre que se abre el modal y se confirma, el
 * backend responde TRANSFER_TARGET_OCCUPIED y se muestra el error.
 */
export function TransferSessionModal({
  sessionId,
  accountLabel,
  onClose,
  onDone,
}: {
  sessionId: number;
  accountLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tables, setTables] = useState<Table[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Destino elegido: id de mesa libre, o "new_bar" para barra nueva.
  const [target, setTarget] = useState<number | "new_bar" | null>(null);
  const [barName, setBarName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    tablesApi
      .getAll()
      .then(setTables)
      .catch((err: unknown) => setLoadError(getErrorMessage(err)));
  }, []);

  // Solo mesas físicas libres. Las barras existentes sin sesión no se
  // ofrecen (una barra vacía no significa nada — para barra se crea
  // una nueva con nombre, que es el flujo walk-in de siempre).
  const freeTables = (tables ?? []).filter(
    (t) => (t.kind ?? "TABLE") === "TABLE" && t.current_session_id == null,
  );

  const barNameValid = barName.trim().length >= 1;
  const canSubmit =
    !submitting && target !== null && (target !== "new_bar" || barNameValid);

  const submit = async () => {
    if (!canSubmit || target === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await tableSessionsApi.transfer(
        sessionId,
        target === "new_bar"
          ? { new_bar_name: barName.trim() }
          : { target_table_id: target },
      );
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
      aria-label="Transferir cuenta"
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
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
              color: C.gold,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Transferir cuenta
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
            {accountLabel}
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
            La cuenta completa (productos, pedidos, pagos y canciones) se
            mueve al destino. La mesa actual queda libre.
          </p>
        </div>

        {loadError && <ErrorRow message={loadError} />}

        {tables === null && !loadError && (
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
            Cargando destinos…
          </p>
        )}

        {tables !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              — Destino
            </span>
            {freeTables.length === 0 && (
              <p
                style={{
                  margin: 0,
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  color: C.mute,
                }}
              >
                No hay mesas libres — solo queda la opción de barra nueva.
              </p>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
              }}
            >
              {freeTables.map((t) => {
                const selected = target === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTarget(t.id)}
                    disabled={submitting}
                    aria-pressed={selected}
                    style={{
                      padding: "12px 8px",
                      background: selected ? C.goldSoft : C.cream,
                      border: `1px solid ${selected ? C.gold : C.sand}`,
                      borderRadius: 10,
                      cursor: submitting ? "not-allowed" : "pointer",
                      fontFamily: FONT_DISPLAY,
                      fontSize: 15,
                      letterSpacing: 1,
                      color: C.ink,
                    }}
                  >
                    Mesa {pad(t.number ?? t.id)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setTarget("new_bar")}
                disabled={submitting}
                aria-pressed={target === "new_bar"}
                style={{
                  padding: "12px 8px",
                  background: target === "new_bar" ? C.goldSoft : C.cream,
                  border: `1px dashed ${
                    target === "new_bar" ? C.gold : C.sand
                  }`,
                  borderRadius: 10,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: FONT_DISPLAY,
                  fontSize: 13,
                  letterSpacing: 1,
                  color: C.cacao,
                }}
              >
                + Barra
              </button>
            </div>
          </div>
        )}

        {target === "new_bar" && (
          <label
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
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
              Nombre de la cuenta en barra (obligatorio)
            </span>
            <input
              type="text"
              value={barName}
              onChange={(e) => setBarName(e.target.value)}
              placeholder="Ej. Camilo"
              maxLength={80}
              disabled={submitting}
              autoFocus
              style={{
                padding: "10px 12px",
                border: `1px solid ${C.sand}`,
                borderRadius: 8,
                fontFamily: FONT_UI,
                fontSize: 13,
                background: C.cream,
                color: C.ink,
                outline: "none",
              }}
            />
          </label>
        )}

        {error && <ErrorRow message={error} />}

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
              background: canSubmit ? C.gold : C.mute,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {submitting ? "Transfiriendo…" : "Transferir"}
          </button>
        </div>
      </div>
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
        background: C.terracottaSoft,
        color: C.terracotta,
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
