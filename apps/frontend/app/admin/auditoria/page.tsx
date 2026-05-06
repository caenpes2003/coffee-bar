"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  auditLogApi,
  type AuditEvent,
  type AuditEventKind,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  btnGhost,
  BUTTON_STYLES,
  timeAgo,
} from "@/lib/theme";

/**
 * Audit log viewer — read-only feed of admin actions worth reviewing.
 * Aggregates two underlying tables on the backend (Consumption ledger +
 * InventoryMovement). Each row shows: WHO did it, WHAT happened, WHEN,
 * with a colored chip per event kind so the operator scans the page
 * fast.
 *
 * Filters live in the URL-less local state because this is an inspection
 * tool, not a heavy reporting surface — if it grows we add date pickers
 * and CSV export, but for the bar's day-to-day this is enough.
 */
export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<AuditEventKind | "all">("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await auditLogApi.list(200);
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    // Light polling: an admin reviewing the audit log usually wants the
    // last action they just took to show up. 15s feels live enough
    // without hammering the DB.
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<AuditEventKind | "all", number> = {
      all: events.length,
      bill_adjustment: 0,
      refund: 0,
      inventory_restock: 0,
      inventory_waste: 0,
      inventory_adjust: 0,
    };
    for (const e of events) c[e.kind] += 1;
    return c;
  }, [events]);

  const visible = useMemo(() => {
    if (kindFilter === "all") return events;
    return events.filter((e) => e.kind === kindFilter);
  }, [events, kindFilter]);

  return (
    <>
      <style>{BUTTON_STYLES}</style>
      <main
        style={{
          minHeight: "100dvh",
          background: C.cream,
          color: C.ink,
          fontFamily: FONT_UI,
          padding: "20px 24px 40px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Crown Bar 4.90 · Operación
            </span>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                color: C.ink,
                letterSpacing: 4,
                margin: "2px 0 0",
                textTransform: "uppercase",
              }}
            >
              Auditoría
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                color: C.cacao,
                fontFamily: FONT_MONO,
                letterSpacing: 0.6,
                lineHeight: 1.5,
                maxWidth: 560,
              }}
            >
              Movimientos manuales del staff: ajustes a la cuenta,
              reembolsos, reposición e inventario. Útil para revisar
              quién hizo qué después de un turno.
            </p>
          </div>
          <Link
            href="/admin"
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              textDecoration: "none",
            }}
          >
            ← Tablero
          </Link>
        </header>

        <FilterBar
          counts={counts}
          active={kindFilter}
          onChange={setKindFilter}
        />

        {loading && events.length === 0 && (
          <p style={emptyStateStyle}>Cargando…</p>
        )}

        {error && (
          <p style={{ ...emptyStateStyle, color: C.terracotta }}>{error}</p>
        )}

        {!loading && !error && visible.length === 0 && (
          <p style={emptyStateStyle}>
            {kindFilter === "all"
              ? "Aún no hay movimientos registrados."
              : "Ningún movimiento de este tipo todavía."}
          </p>
        )}

        {visible.length > 0 && (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {visible.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </main>
    </>
  );
}

// ─── Filter chips ────────────────────────────────────────────────────────────

function FilterBar({
  counts,
  active,
  onChange,
}: {
  counts: Record<AuditEventKind | "all", number>;
  active: AuditEventKind | "all";
  onChange: (k: AuditEventKind | "all") => void;
}) {
  const filters: { key: AuditEventKind | "all"; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "bill_adjustment", label: "Ajustes / Descuentos" },
    { key: "refund", label: "Reembolsos" },
    { key: "inventory_restock", label: "Reposición" },
    { key: "inventory_waste", label: "Mermas" },
    { key: "inventory_adjust", label: "Correcciones stock" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 18,
      }}
    >
      {filters.map((f) => {
        const selected = active === f.key;
        const count = counts[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            style={{
              padding: "8px 14px",
              border: `1px solid ${selected ? C.ink : C.sand}`,
              background: selected ? C.ink : C.paper,
              color: selected ? C.paper : C.cacao,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 1.5,
              fontWeight: 700,
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            {f.label}
            <span
              style={{
                marginLeft: 8,
                padding: "1px 8px",
                background: selected ? `${C.paper}26` : C.cream,
                color: selected ? C.paper : C.mute,
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Event row ───────────────────────────────────────────────────────────────

const KIND_META: Record<
  AuditEventKind,
  { label: string; tone: string; bg: string }
> = {
  bill_adjustment: {
    label: "Cuenta",
    tone: C.gold,
    bg: `${C.gold}11`,
  },
  refund: {
    label: "Reembolso",
    tone: C.terracotta,
    bg: `${C.terracotta}11`,
  },
  inventory_restock: {
    label: "Reposición",
    tone: C.olive,
    bg: `${C.olive}11`,
  },
  inventory_waste: {
    label: "Merma",
    tone: C.terracotta,
    bg: `${C.terracotta}11`,
  },
  inventory_adjust: {
    label: "Stock",
    tone: C.cacao,
    bg: `${C.cacao}11`,
  },
};

function EventRow({ event }: { event: AuditEvent }) {
  const meta = KIND_META[event.kind];
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "12px 14px",
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 12,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          padding: "4px 10px",
          background: meta.bg,
          color: meta.tone,
          border: `1px solid ${meta.tone}33`,
          borderRadius: 999,
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {meta.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 14,
            color: C.ink,
            lineHeight: 1.4,
          }}
        >
          {event.summary}
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.mute,
            letterSpacing: 0.4,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <span>{timeAgo(event.created_at)}</span>
          {event.created_by && (
            <span>
              por <strong style={{ color: C.cacao }}>{event.created_by}</strong>
            </span>
          )}
          {event.context.table_id != null && (
            <span>mesa {event.context.table_id}</span>
          )}
          {event.context.product_name && (
            <span>{event.context.product_name}</span>
          )}
        </div>
      </div>
    </li>
  );
}

const emptyStateStyle: React.CSSProperties = {
  margin: 0,
  padding: "32px 18px",
  textAlign: "center",
  fontFamily: FONT_MONO,
  fontSize: 12,
  color: C.mute,
  letterSpacing: 1,
  background: C.paper,
  border: `1px dashed ${C.sand}`,
  borderRadius: 12,
};
