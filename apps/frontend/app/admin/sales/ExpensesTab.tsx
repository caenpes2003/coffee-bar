"use client";

import { useCallback, useEffect, useState } from "react";
import { expensesApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useEscapeKey } from "@/lib/hooks/useEscapeKey";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt } from "@/lib/theme";
import type {
  Expense,
  ExpenseCategory,
  PaymentMethod,
} from "@coffee-bar/shared";
import { ExpenseModal } from "@/components/admin/ExpenseModal";

/**
 * Tab "Gastos" del /admin/sales (Fase A+ Gastos v1, G3.3).
 *
 * Lista los últimos 100 egresos con filtros por método y categoría.
 * Botón "+ Nuevo gasto" en la cabecera abre el ExpenseModal (mismo
 * modal del banner). Cada fila tiene botón "Reversar" que abre
 * inline-prompt para razón.
 *
 * Los reversos se muestran como filas separadas (kind=reversal) con
 * amount negativo y color burgundy. Los originales ya reversados
 * aparecen con opacidad reducida y badge "reversado".
 */

// En gastos no distinguimos tarjeta vs QR Bold — ambos se muestran
// como "Bold" (el proveedor no siempre aclara cuál, y para el saldo
// netean juntos).
const METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  tarjeta_bold: "Bold",
  qr_bold: "Bold",
};

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  mercancia: "Mercancía",
  insumos: "Insumos",
  mantenimiento: "Mantenimiento",
  servicios: "Servicios",
  personal: "Personal",
  otros: "Otros",
};

export function ExpensesTab() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Expense | null>(null);
  // Filtro de método simplificado a Efectivo / Bold (bold = tarjeta+qr).
  const [methodFilter, setMethodFilter] = useState<
    "all" | "efectivo" | "bold"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<
    ExpenseCategory | "all"
  >("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      // Backend filtra por método exacto, pero "bold" agrupa dos
      // métodos — así que en ese caso traemos por categoría y
      // filtramos el método en cliente.
      const data = await expensesApi.list({
        category: categoryFilter === "all" ? undefined : categoryFilter,
        limit: 100,
      });
      const filtered =
        methodFilter === "all"
          ? data
          : methodFilter === "efectivo"
            ? data.filter((e) => e.method === "efectivo")
            : data.filter(
                (e) =>
                  e.method === "tarjeta_bold" || e.method === "qr_bold",
              );
      setExpenses(filtered);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [methodFilter, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Set de ids con reverso para deshabilitar el botón en originales
  // ya anulados.
  const reversedIds = new Set<number>();
  if (expenses) {
    for (const e of expenses) {
      if (e.kind === "reversal" && e.reverses_id != null) {
        reversedIds.add(e.reverses_id);
      }
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              letterSpacing: 0.5,
              color: C.ink,
            }}
          >
            Gastos del bar
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 1,
              color: C.mute,
            }}
          >
            Últimos 100 egresos. Cada uno descuenta del cuadre de su
            jornada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            padding: "10px 22px",
            border: "none",
            borderRadius: 999,
            background: C.terracotta,
            color: C.paper,
            fontFamily: FONT_DISPLAY,
            fontSize: 13,
            letterSpacing: 2.5,
            cursor: "pointer",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          + Nuevo gasto
        </button>
      </header>

      <FiltersBar
        method={methodFilter}
        setMethod={setMethodFilter}
        category={categoryFilter}
        setCategory={setCategoryFilter}
      />

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 12,
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

      {expenses === null && !error && (
        <p
          style={{
            margin: 0,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          Cargando gastos…
        </p>
      )}

      {expenses !== null && expenses.length === 0 && (
        <p
          style={{
            margin: 0,
            padding: "20px 16px",
            background: C.cream,
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: C.cacao,
            textAlign: "center",
          }}
        >
          No hay gastos registrados con los filtros actuales.
        </p>
      )}

      {expenses !== null && expenses.length > 0 && (
        <ExpensesList
          expenses={expenses}
          reversedIds={reversedIds}
          onReverse={(e) => setReverseTarget(e)}
        />
      )}

      {createOpen && (
        <ExpenseModal
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      )}

      {reverseTarget && (
        <ReverseExpenseModal
          expense={reverseTarget}
          onClose={() => setReverseTarget(null)}
          onDone={() => {
            setReverseTarget(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

// ─── Filtros ──────────────────────────────────────────────────────────────

function FiltersBar({
  method,
  setMethod,
  category,
  setCategory,
}: {
  method: "all" | "efectivo" | "bold";
  setMethod: (v: "all" | "efectivo" | "bold") => void;
  category: ExpenseCategory | "all";
  setCategory: (v: ExpenseCategory | "all") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "flex-end",
        padding: "10px 14px",
        background: C.cream,
        border: `1px solid ${C.sand}`,
        borderRadius: 10,
      }}
    >
      <FilterGroup label="Método">
        <Chip active={method === "all"} onClick={() => setMethod("all")}>
          Todos
        </Chip>
        {(
          [
            { key: "efectivo", label: "Efectivo" },
            { key: "bold", label: "Bold" },
          ] as { key: "efectivo" | "bold"; label: string }[]
        ).map((m) => (
          <Chip
            key={m.key}
            active={method === m.key}
            onClick={() => setMethod(m.key)}
          >
            {m.label}
          </Chip>
        ))}
      </FilterGroup>
      <FilterGroup label="Categoría">
        <Chip
          active={category === "all"}
          onClick={() => setCategory("all")}
        >
          Todas
        </Chip>
        {(Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).map((c) => (
          <Chip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
          >
            {CATEGORY_LABEL[c]}
          </Chip>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? C.ink : C.sand}`,
        background: active ? C.ink : C.paper,
        color: active ? C.paper : C.cacao,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        cursor: "pointer",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

// ─── Lista de gastos ──────────────────────────────────────────────────────

function ExpensesList({
  expenses,
  reversedIds,
  onReverse,
}: {
  expenses: Expense[];
  reversedIds: Set<number>;
  onReverse: (e: Expense) => void;
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {expenses.map((e) => {
        const isReversal = e.kind === "reversal";
        const alreadyReversed = reversedIds.has(e.id);
        const canReverse = !isReversal && !alreadyReversed;
        return (
          <li
            key={e.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              background: isReversal ? C.terracottaSoft : C.paper,
              border: `1px solid ${isReversal ? C.terracotta : C.sand}`,
              borderRadius: 10,
              opacity: alreadyReversed ? 0.6 : 1,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                  fontWeight: 700,
                }}
              >
                {e.concept}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  letterSpacing: 0.5,
                  color: C.mute,
                }}
              >
                {CATEGORY_LABEL[e.category]} · {METHOD_LABEL[e.method]} ·{" "}
                {formatDateTime(e.created_at)}
                {e.created_by ? ` · ${e.created_by}` : ""}
                {e.supplier ? ` · ${e.supplier}` : ""}
                {alreadyReversed ? " · reversado" : ""}
              </span>
              {isReversal && e.reverse_reason && (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 0.5,
                    color: C.terracotta,
                    marginTop: 2,
                  }}
                >
                  Motivo: {e.reverse_reason}
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <strong
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 18,
                  color: isReversal ? C.terracotta : C.ink,
                  letterSpacing: 0.5,
                }}
              >
                {e.amount < 0 ? "−" : "−"}
                {fmt(Math.abs(e.amount))}
              </strong>
              {canReverse && (
                <button
                  type="button"
                  onClick={() => onReverse(e)}
                  style={{
                    padding: "4px 10px",
                    border: `1px solid ${C.terracotta}`,
                    background: "transparent",
                    color: C.terracotta,
                    borderRadius: 999,
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Reversar
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Modal de reverso ─────────────────────────────────────────────────────

function ReverseExpenseModal({
  expense,
  onClose,
  onDone,
}: {
  expense: Expense;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onClose);

  const canSubmit = reason.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await expensesApi.reverse(expense.id, { reason: reason.trim() });
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
      aria-label="Reversar gasto"
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
          maxWidth: 460,
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
              color: C.terracotta,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Reversar gasto
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
            {expense.concept}
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: C.mute,
            }}
          >
            {METHOD_LABEL[expense.method]} · {fmt(expense.amount)}
          </p>
          <p
            style={{
              margin: "10px 0 0",
              fontFamily: FONT_UI,
              fontSize: 12,
              lineHeight: 1.5,
              color: C.cacao,
            }}
          >
            El gasto original NO se borra. Se crea una fila de reverso
            con el monto opuesto y se devuelve al cuadre de la jornada
            actual.
          </p>
        </div>

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
            Motivo (mín. 3 caracteres)
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. error de monto, gasto duplicado"
            maxLength={500}
            disabled={submitting}
            autoFocus
            style={{
              padding: "10px 12px",
              border: `1px solid ${C.sand}`,
              borderRadius: 8,
              fontFamily: FONT_MONO,
              fontSize: 13,
              background: C.cream,
              color: C.ink,
              outline: "none",
            }}
          />
        </label>

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
          <button
            type="button"
            onClick={onClose}
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
              cursor: submitting ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              opacity: submitting ? 0.5 : 1,
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
              background: canSubmit ? C.terracotta : C.mute,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {submitting ? "Reversando…" : "Reversar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}
