"use client";

/**
 * Admin bill drawer for a single TableSession.
 *
 * Strict separation (Phase F3):
 *   - bill.summary / bill.items → backend ledger, single source of truth.
 *   - We never sum from orders in the UI.
 *   - Staff actions (adjustment / discount / refund) are three separate,
 *     explicit flows with mandatory reason.
 *   - A closed session is read-only; action UI is hidden.
 *   - `reason` is always visible on the ledger row so operators and support
 *     can audit why the bill changed.
 */
import { useCallback, useEffect, useState } from "react";
import { useSocket } from "@/lib/socket/useSocket";
import {
  billApi,
  orderRequestsApi,
  paymentsApi,
  productsApi,
  tableSessionsApi,
  type ProductRecipeSlotView,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type {
  BillView,
  Consumption,
  MarkPaidPaymentInput,
  Payment,
  PaymentMethod,
  PaymentReverseReason,
  Product,
  TableSession,
} from "@coffee-bar/shared";
import {
  CompositionPicker,
  type CompositionPick,
} from "../orders/CompositionPicker";
import { CancelButton } from "./CancelButton";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");

const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
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

type ActionKind =
  | "adjustment"
  | "discount"
  | "refund"
  | "partial_payment"
  | "products";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: number | null;
  tableNumber: number | null;
  /**
   * Pre-computed display label for the account ("Mesa 03", "Camilo",
   * etc.). The drawer renders it as-is — so the parent stays the
   * single source of truth for naming. Falls back to a sensible
   * default when omitted, but new callers should always provide it.
   */
  accountLabel?: string;
}

export function AdminBillDrawer({
  open,
  onClose,
  sessionId,
  tableNumber,
  accountLabel,
}: Props) {
  const [bill, setBill] = useState<BillView | null>(null);
  const [session, setSession] = useState<TableSession | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState<
    "mark-paid" | "close" | null
  >(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Fase A+ B3.7: modal de reverso de Payment. payment=null => cerrado.
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const [actionOpen, setActionOpen] = useState<null | {
    kind: ActionKind;
    consumptionId?: number;
    defaultDescription?: string;
  }>(null);

  const [confirmOpen, setConfirmOpen] = useState<null | {
    kind: "mark-paid" | "close";
  }>(null);
  // Modal separado para anular (void): requiere razón obligatoria, no
  // es un confirm simple. Se dispara cuando el total > 0 y no se cobró
  // — el flujo "close" simple solo aplica a cuentas con total 0.
  const [voidOpen, setVoidOpen] = useState(false);

  const load = useCallback(() => {
    if (sessionId == null) return;
    setLoadError(null);
    setPaymentError(null);
    billApi
      .getForAdmin(sessionId)
      .then(setBill)
      .catch((e: unknown) => setLoadError(getErrorMessage(e)));
    tableSessionsApi
      .getById(sessionId)
      .then(setSession)
      .catch((e: unknown) => setLoadError(getErrorMessage(e)));
    // Payments cargan independientes: si la sesión no tiene cobros
    // (apenas abierta), la lista vendrá vacía — no es error.
    paymentsApi
      .listForSession(sessionId)
      .then(setPayments)
      .catch(() => setPayments([]));
  }, [sessionId]);

  useEffect(() => {
    if (open && sessionId != null) load();
    if (!open) {
      setBill(null);
      setSession(null);
      setPayments([]);
      setPaymentError(null);
      setReverseTarget(null);
      setReverseError(null);
    }
  }, [open, sessionId, load]);

  // Subscribe to bill updates for this session. Filter by session_id to avoid
  // cross-session cross-talk even though staff broadcast is global today.
  useSocket({
    staff: true,
    onBillUpdated: (b) => {
      if (sessionId != null && b.session_id === sessionId) setBill(b);
    },
    onTableSessionUpdated: (s) => {
      if (sessionId != null && s.id === sessionId) {
        // Merge instead of replace: the socket payload is `Partial<TableSession>`
        // and we want to keep the rest of the row.
        setSession((prev) => (prev ? { ...prev, ...s } : prev));
      }
    },
    onTableSessionClosed: (s) => {
      if (sessionId != null && s.id === sessionId) {
        setSession((prev) => (prev ? { ...prev, ...s } : prev));
      }
    },
  });

  async function runPaymentAction(kind: "mark-paid" | "close") {
    if (sessionId == null) return;
    setPaymentBusy(kind);
    setPaymentError(null);
    try {
      if (kind === "mark-paid") {
        // Legacy code path: el confirm simple ya no se usa para mark-paid
        // (Fase A+ B3 movió el flujo al MarkPaidModal con selector de
        // método). Quedó por si algún caller futuro necesita "cobrar
        // legacy efectivo" — el backend acepta payments omitidos como
        // retrocompat, pero la UI no debería usarlo en producción.
        await tableSessionsApi.markPaid(sessionId);
        onClose();
      } else {
        await tableSessionsApi.close(sessionId);
        onClose();
      }
    } catch (err) {
      setPaymentError(getErrorMessage(err));
    } finally {
      setPaymentBusy(null);
    }
  }

  /**
   * Fase A+ B3.5: cobrar con N métodos (cobros divididos). El modal
   * valida que la suma coincida con el pendiente antes de invocar; el
   * backend revalida con tolerancia ±$0.5. Si todos los pagos van con
   * el mismo método, el modal envía igual un array de 1 elemento — el
   * backend lo trata idénticamente.
   */
  async function runMarkPaidWithPayments(
    payments: MarkPaidPaymentInput[],
  ) {
    if (sessionId == null) return;
    setPaymentBusy("mark-paid");
    setPaymentError(null);
    try {
      await tableSessionsApi.markPaid(sessionId, payments);
      onClose();
    } catch (err) {
      setPaymentError(getErrorMessage(err));
    } finally {
      setPaymentBusy(null);
    }
  }

  /**
   * Fase A+ B3.7: reversar un Payment. El service del backend crea
   * una fila kind=reversal con amount opuesto y deja el original
   * intacto. Tras éxito refrescamos el bill (porque si era un parcial,
   * su Consumption negativo cambió la suma) y la lista de Payments.
   */
  async function runReverse(
    paymentId: number,
    body: { reason: PaymentReverseReason; reason_detail?: string },
  ) {
    setReverseBusy(true);
    setReverseError(null);
    try {
      await paymentsApi.reverse(paymentId, body);
      setReverseTarget(null);
      load();
    } catch (err) {
      setReverseError(getErrorMessage(err));
    } finally {
      setReverseBusy(false);
    }
  }

  async function runVoidAction(body: {
    reason: "customer_left" | "admin_error" | "comp" | "other";
    other_detail?: string;
  }) {
    if (sessionId == null) return;
    setPaymentBusy("close");
    setPaymentError(null);
    try {
      await tableSessionsApi.voidSession(sessionId, body);
      setVoidOpen(false);
      onClose();
    } catch (err) {
      setPaymentError(getErrorMessage(err));
    } finally {
      setPaymentBusy(null);
    }
  }

  if (!open || sessionId == null) return null;

  const readOnly = bill?.status === "closed";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Cuenta de mesa"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <style>{`
        .crown-btn-action,
        .crown-btn-primary,
        .crown-btn-ghost {
          transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 200ms ease,
                      background 160ms ease,
                      color 160ms ease,
                      border-color 160ms ease;
        }
        .crown-btn-action:hover:not(:disabled) {
          transform: translateY(-1px);
          background: ${C.cream};
          box-shadow: 0 8px 18px -10px rgba(107,78,46,0.45);
        }
        .crown-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.07);
          box-shadow: 0 12px 22px -12px rgba(43,29,20,0.5);
        }
        .crown-btn-primary:active:not(:disabled) {
          transform: translateY(0);
        }
        .crown-btn-ghost:hover:not(:disabled) {
          background: ${C.cream};
          color: ${C.ink};
          border-color: ${C.cacao};
        }
      `}</style>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          height: "100%",
          background: C.paper,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 60px -20px rgba(43,29,20,0.45)",
        }}
      >
        <BillHeader
          tableNumber={tableNumber}
          accountLabel={accountLabel}
          bill={bill}
          onClose={onClose}
        />

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 22px 24px",
          }}
        >
          {loadError && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: 12,
                background: C.burgundySoft,
                color: C.burgundy,
                borderRadius: 8,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              {loadError}
            </p>
          )}

          {bill && (
            <>
              <SummaryGrid summary={bill.summary} />
              <LedgerList
                items={bill.items}
                readOnly={readOnly}
                onRefund={(c) =>
                  setActionOpen({
                    kind: "refund",
                    consumptionId: c.id,
                    defaultDescription: c.description,
                  })
                }
              />
              {payments.length > 0 && (
                <PaymentsList
                  payments={payments}
                  onReverse={(p) => setReverseTarget(p)}
                />
              )}
            </>
          )}
        </div>

        {!readOnly && bill && (
          <footer
            style={{
              padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${C.sand}`,
              background: C.cream,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {paymentError && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.burgundy,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                {paymentError}
              </p>
            )}
            {session?.payment_requested_at && (
              <div
                style={{
                  padding: "8px 10px",
                  background: C.goldSoft,
                  border: `1px solid ${C.gold}`,
                  borderRadius: 8,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.cacao,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                ★ Cliente pidió la cuenta
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setActionOpen({ kind: "products" })}
                className="crown-btn-action"
                style={adjustmentButtonStyle(C.gold)}
              >
                + Productos
              </button>
              <button
                type="button"
                onClick={() => setActionOpen({ kind: "discount" })}
                className="crown-btn-action"
                style={adjustmentButtonStyle(C.cacao)}
              >
                − Descuento
              </button>
            </div>

            {/* Payment + close cluster.
                Contextual rules:
                  - total = 0 → only "Cerrar" (renamed from
                    "Cerrar sin cobrar" since there's nothing to charge).
                  - total > 0 → "Pago parcial" + "Cobrar y cerrar" +
                    "Cerrar sin cobrar". */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 10,
                borderTop: `1px solid ${C.sand}`,
              }}
            >
              {bill.summary.total > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setActionOpen({ kind: "partial_payment" })}
                    className="crown-btn-primary"
                    style={primaryActionStyle(false, C.gold)}
                  >
                    Registrar pago parcial
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen({ kind: "mark-paid" })}
                    disabled={paymentBusy != null}
                    className="crown-btn-primary"
                    style={primaryActionStyle(
                      paymentBusy === "mark-paid",
                      C.olive,
                    )}
                  >
                    {paymentBusy === "mark-paid"
                      ? "Cobrando..."
                      : "Cobrar y cerrar cuenta"}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  if (bill.summary.total > 0) {
                    // Anular: requiere razón obligatoria por trazabilidad.
                    setVoidOpen(true);
                  } else {
                    // Cuenta vacía (no se consumió nada): cierre simple sin
                    // razón. El backend permite /close cuando paid_at != null
                    // O cuando total = 0 (revisar service si cambia).
                    setConfirmOpen({ kind: "close" });
                  }
                }}
                disabled={paymentBusy != null}
                className="crown-btn-ghost"
                style={secondaryActionStyle(paymentBusy === "close")}
              >
                {paymentBusy === "close"
                  ? "Cerrando..."
                  : bill.summary.total > 0
                    ? "Anular sin cobrar"
                    : "Cerrar cuenta"}
              </button>
            </div>
          </footer>
        )}

        {readOnly && (
          <footer
            style={{
              padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${C.sand}`,
              background: C.cream,
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
            }}
          >
            Sesión cerrada — sólo lectura
          </footer>
        )}
      </aside>

      {actionOpen && sessionId != null && actionOpen.kind === "products" && (
        <ProductsAddModal
          sessionId={sessionId}
          onClose={() => setActionOpen(null)}
          onDone={() => {
            setActionOpen(null);
            // bill:updated will refresh the drawer; no manual refetch.
          }}
        />
      )}
      {actionOpen && sessionId != null && actionOpen.kind !== "products" && (
        <ActionModal
          kind={actionOpen.kind}
          sessionId={sessionId}
          consumptionId={actionOpen.consumptionId}
          defaultDescription={actionOpen.defaultDescription}
          onClose={() => setActionOpen(null)}
          onDone={() => {
            setActionOpen(null);
          }}
        />
      )}

      {voidOpen && (
        <VoidReasonModal
          tableNumber={tableNumber}
          totalPending={bill?.summary.total ?? 0}
          busy={paymentBusy === "close"}
          onSubmit={(body) => void runVoidAction(body)}
          onCancel={() => setVoidOpen(false)}
        />
      )}

      {confirmOpen && confirmOpen.kind === "mark-paid" && bill && (
        <MarkPaidModal
          accountLabel={accountLabel ?? `Mesa ${tableNumber ?? ""}`}
          pending={bill.summary.total}
          busy={paymentBusy === "mark-paid"}
          error={paymentError}
          onConfirm={(payments) => {
            setConfirmOpen(null);
            void runMarkPaidWithPayments(payments);
          }}
          onCancel={() => setConfirmOpen(null)}
        />
      )}

      {confirmOpen && confirmOpen.kind === "close" && (
        <ConfirmModal
          tone="burgundy"
          eyebrow="— Cerrar cuenta"
          title={
            (bill?.summary.total ?? 0) > 0
              ? "¿Cerrar sin cobrar?"
              : "¿Cerrar la cuenta?"
          }
          body={
            (bill?.summary.total ?? 0) > 0
              ? "El total quedará sin pagar y la cuenta se cerrará."
              : "La cuenta se cerrará."
          }
          confirmLabel="Sí, cerrar"
          onConfirm={() => {
            setConfirmOpen(null);
            runPaymentAction("close");
          }}
          onCancel={() => setConfirmOpen(null)}
        />
      )}

      {reverseTarget && (
        <ReversePaymentModal
          payment={reverseTarget}
          busy={reverseBusy}
          error={reverseError}
          onConfirm={(body) => void runReverse(reverseTarget.id, body)}
          onCancel={() => {
            setReverseTarget(null);
            setReverseError(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
function BillHeader({
  tableNumber,
  accountLabel,
  bill,
  onClose,
}: {
  tableNumber: number | null;
  accountLabel?: string;
  bill: BillView | null;
  onClose: () => void;
}) {
  const statusColor: Record<string, { bg: string; fg: string }> = {
    open: { bg: C.oliveSoft, fg: C.olive },
    ordering: { bg: C.oliveSoft, fg: C.olive },
    closing: { bg: C.goldSoft, fg: C.cacao },
    closed: { bg: C.sand, fg: C.mute },
  };
  const statusMeta = bill
    ? statusColor[bill.status] ?? { bg: C.sand, fg: C.mute }
    : { bg: C.sand, fg: C.mute };
  return (
    <header
      style={{
        padding: "20px 22px 16px",
        borderBottom: `1px solid ${C.sand}`,
        background: C.paper,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
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
          — Cuenta
        </span>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            letterSpacing: 0.5,
            color: C.ink,
            margin: "2px 0 0",
            lineHeight: 1,
          }}
        >
          {accountLabel ?? (tableNumber != null ? `Mesa ${pad(tableNumber)}` : "—")}
        </h2>
        {bill && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                background: statusMeta.bg,
                color: statusMeta.fg,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.5,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {bill.status}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.mute,
                letterSpacing: 1,
              }}
            >
              abierta {new Date(bill.opened_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        style={{
          background: "transparent",
          border: `1px solid ${C.sand}`,
          borderRadius: 999,
          width: 36,
          height: 36,
          fontSize: 18,
          color: C.cacao,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </header>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────
function SummaryGrid({ summary }: { summary: BillView["summary"] }) {
  const rows: { label: string; value: number; color: string; bold?: boolean }[] = [
    { label: "Subtotal", value: summary.subtotal, color: C.ink },
    { label: "Descuentos", value: summary.discounts_total, color: C.cacao },
    { label: "Ajustes", value: summary.adjustments_total, color: C.cacao },
    { label: "Total", value: summary.total, color: C.gold, bold: true },
  ];
  return (
    <div
      style={{
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        background: C.cream,
        padding: "14px 18px",
        marginBottom: 22,
      }}
    >
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "6px 0",
            borderTop: i === rows.length - 1 ? `1px solid ${C.sand}` : "none",
            marginTop: i === rows.length - 1 ? 8 : 0,
            paddingTop: i === rows.length - 1 ? 12 : 6,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: r.bold ? 11 : 10,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: r.bold ? 700 : 600,
            }}
          >
            {r.label}
          </span>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: r.bold ? 28 : 18,
              color: r.color,
              letterSpacing: 0.5,
            }}
          >
            {fmt(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Ledger ──────────────────────────────────────────────────────────────────
function LedgerList({
  items,
  readOnly,
  onRefund,
}: {
  items: Consumption[];
  readOnly: boolean;
  onRefund: (c: Consumption) => void;
}) {
  const typeMeta: Record<
    string,
    { label: string; bg: string; fg: string }
  > = {
    product: { label: "Producto", bg: C.goldSoft, fg: C.cacao },
    adjustment: { label: "Ajuste", bg: C.sandDark, fg: C.ink },
    discount: { label: "Descuento", bg: C.oliveSoft, fg: C.olive },
    refund: { label: "Reembolso", bg: C.burgundySoft, fg: C.burgundy },
  };

  return (
    <div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        — Detalle cronológico
      </div>
      {items.length === 0 && (
        <p
          style={{
            padding: "24px 0",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.mute,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Sin movimientos
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((c) => {
          const meta = typeMeta[c.type] ?? {
            label: c.type,
            bg: C.sand,
            fg: C.ink,
          };
          const reversed = c.reversed_at != null;
          const canRefund =
            !readOnly &&
            !reversed &&
            c.type !== "refund" &&
            typeof onRefund === "function";
          return (
            <li
              key={c.id}
              style={{
                padding: "12px 0",
                borderBottom: `1px solid ${C.sand}`,
                opacity: reversed ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 14,
                      color: C.ink,
                      textDecoration: reversed ? "line-through" : "none",
                    }}
                  >
                    {c.description}
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: C.mute,
                      letterSpacing: 1,
                      marginTop: 3,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        padding: "1px 7px",
                        background: meta.bg,
                        color: meta.fg,
                        borderRadius: 999,
                        letterSpacing: 1,
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {meta.label}
                    </span>
                    {c.quantity !== 1 && <span>{c.quantity}×</span>}
                    <span>
                      {new Date(c.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {reversed && (
                      <span style={{ color: C.burgundy, fontWeight: 700 }}>
                        REVERSADA
                      </span>
                    )}
                    {c.reverses_id != null && (
                      <span>↻ Reversa #{c.reverses_id}</span>
                    )}
                  </div>
                  {c.reason && (
                    <div
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        color: C.cacao,
                        fontStyle: "italic",
                        marginTop: 4,
                      }}
                    >
                      “{c.reason}”
                      {c.created_by && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontStyle: "normal",
                            color: C.mute,
                            fontSize: 11,
                          }}
                        >
                          · {c.created_by}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 18,
                    color: Number(c.amount) < 0 ? C.olive : C.gold,
                    letterSpacing: 0.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmt(Number(c.amount))}
                </div>
              </div>
              {canRefund && (
                <button
                  type="button"
                  onClick={() => onRefund(c)}
                  style={{
                    marginTop: 8,
                    padding: "4px 10px",
                    border: `1px solid ${C.burgundy}`,
                    background: "transparent",
                    color: C.burgundy,
                    borderRadius: 999,
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    cursor: "pointer",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  Devolver
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type SimpleActionKind = Exclude<ActionKind, "products">;

// ─── Action modal (adjustment | discount | refund | partial_payment) ────────
function ActionModal({
  kind,
  sessionId,
  consumptionId,
  defaultDescription,
  onClose,
  onDone,
}: {
  kind: SimpleActionKind;
  sessionId: number;
  consumptionId?: number;
  defaultDescription?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  // Aplica solo a refunds. Por default ON: la mayoría de las
  // devoluciones son "error de cargo" o "cliente no consumió" y el
  // producto vuelve al stock. Si el producto se rompió/derramó se
  // marca OFF y el stock queda como estaba.
  const [restoreStock, setRestoreStock] = useState(true);
  // Aplica solo a partial_payment (Fase A+ B3). Sin default: forzamos
  // al cajero a elegir explícitamente antes de habilitar el botón —
  // un default invisible llevaría a registrar todo como efectivo y
  // arruinar la conciliación silenciosamente.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === "adjustment"
      ? "Cargo manual"
      : kind === "discount"
        ? "Descuento"
        : kind === "partial_payment"
          ? "Pago parcial"
          : "Devolver consumo";

  const amountNum = Number(amountStr);
  const amountValid =
    kind === "refund"
      ? true
      : kind === "partial_payment"
        ? amountStr.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0
        : amountStr.trim().length > 0 && Number.isFinite(amountNum) && amountNum !== 0;

  // Partial payments don't ask for a reason — the receipt label is auto.
  const reasonValid =
    kind === "partial_payment" ? true : reason.trim().length >= 3;
  // Partial payments también exigen método (Fase A+ B3). Sin método
  // no podemos crear el Payment row que la conciliación necesita.
  const methodValid =
    kind === "partial_payment" ? paymentMethod !== null : true;
  const canSubmit = amountValid && reasonValid && methodValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // `created_by` is stamped by the backend from the admin JWT (G6).
      // The UI used to accept a manual "Responsable" field; it is gone now.
      if (kind === "refund") {
        if (consumptionId == null) throw new Error("Missing consumption id");
        await billApi.refundConsumption(consumptionId, {
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          restore_stock: restoreStock,
        });
      } else if (kind === "partial_payment") {
        if (paymentMethod == null) {
          throw new Error("Selecciona un método de pago");
        }
        await billApi.recordPartialPayment(
          sessionId,
          amountNum,
          paymentMethod,
        );
      } else {
        // Narrows to "adjustment" | "discount" — the only two kinds
        // left after refund/partial_payment branches above.
        await billApi.createAdjustment(sessionId, {
          type: kind as "adjustment" | "discount",
          amount: amountNum,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
        });
      }
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
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        // stopPropagation: el modal vive dentro de AdminBillDrawer, cuyo
        // overlay tiene onClick=onClose. Sin esto, clics dentro del modal
        // burbujean hasta el drawer y lo cierran (regresión del commit
        // 7ca7df2 que removió click-outside-cierra de los modales pero
        // dejó al overlay del drawer atrapando esos eventos).
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
        }}
      >
        <div>
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
            — Acción
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "2px 0 0",
            }}
          >
            {title}
          </h3>
          {kind === "refund" && defaultDescription && (
            <p
              style={{
                margin: "6px 0 0",
                fontFamily: FONT_UI,
                fontSize: 13,
                color: C.cacao,
              }}
            >
              Consumo: <em>{defaultDescription}</em>
            </p>
          )}
        </div>

        {kind !== "refund" && (
          <label style={labelStyle}>
            <span style={labelTextStyle}>
              Monto (COP)
              {kind === "discount" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    color: C.mute,
                  }}
                >
                  se registra como negativo
                </span>
              )}
              {kind === "partial_payment" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    color: C.mute,
                  }}
                >
                  se descuenta del pendiente
                </span>
              )}
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </label>
        )}

        {kind === "partial_payment" && (
          <PaymentMethodSelector
            value={paymentMethod}
            onChange={setPaymentMethod}
            disabled={submitting}
          />
        )}

        {kind !== "partial_payment" && (
          <>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Razón (obligatoria)</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: cortesía, corrección manual, rotura…"
                maxLength={200}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              <span style={labelTextStyle}>Notas internas (opcional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
              />
            </label>
          </>
        )}

        {kind === "refund" && (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              border: `1px solid ${C.sand}`,
              borderRadius: 10,
              background: C.cream,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={restoreStock}
              onChange={(e) => setRestoreStock(e.target.checked)}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 13,
                  color: C.ink,
                  fontWeight: 600,
                }}
              >
                Reponer stock
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 0.5,
                  color: C.mute,
                  marginTop: 2,
                  lineHeight: 1.5,
                }}
              >
                {restoreStock
                  ? "El producto vuelve al inventario. Activá esto si fue error de cargo o el cliente no lo consumió."
                  : "El producto NO se repone. Marcá esto si se rompió, derramó o ya se consumió."}
              </div>
            </div>
          </label>
        )}


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

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <CancelButton onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit ? C.ink : C.sand,
              color: canSubmit ? C.paper : C.mute,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 3,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
            }}
          >
            {submitting ? "Guardando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles helpers ──────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
};
const labelTextStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
};

function adjustmentButtonStyle(borderColor: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "12px 0",
    border: `1px solid ${borderColor}`,
    borderRadius: 999,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT_DISPLAY,
    fontSize: 13,
    letterSpacing: 2.5,
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function primaryActionStyle(busy: boolean, accent: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "12px 14px",
    border: "none",
    borderRadius: 999,
    background: busy ? C.sand : accent,
    color: busy ? C.mute : C.paper,
    fontFamily: FONT_DISPLAY,
    fontSize: 13,
    letterSpacing: 2.5,
    cursor: busy ? "not-allowed" : "pointer",
    textTransform: "uppercase",
    fontWeight: 600,
    opacity: busy ? 0.7 : 1,
  };
}

function secondaryActionStyle(busy: boolean): React.CSSProperties {
  // Ghost / muted secondary action. Neutral on rest, fills in slightly
  // on hover (handled in the <style> block above). Reads as "not the
  // primary thing here" without screaming danger like burgundy did.
  return {
    flex: 1,
    padding: "10px 14px",
    border: `1px solid ${C.sandDark}`,
    borderRadius: 999,
    background: "transparent",
    color: C.cacao,
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: 2,
    cursor: busy ? "not-allowed" : "pointer",
    textTransform: "uppercase",
    fontWeight: 700,
    opacity: busy ? 0.6 : 1,
  };
}

function ConfirmModal({
  tone,
  eyebrow,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  tone: "olive" | "burgundy";
  eyebrow: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const accent = tone === "olive" ? C.olive : C.burgundy;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 20,
      }}
    >
      <div
        // stopPropagation: ver comentario en ActionModal. Mismo motivo —
        // el modal vive dentro de AdminBillDrawer.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: accent,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {eyebrow}
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "4px 0 0",
            }}
          >
            {title}
          </h3>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 14,
            lineHeight: 1.5,
            color: C.cacao,
          }}
        >
          {body}
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 6,
          }}
        >
          <CancelButton onClick={onCancel} />
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: accent,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Products add modal ──────────────────────────────────────────────────────
/**
 * Staff-side "+ Productos" modal. Lists the catalog grouped by
 * category with quantity steppers; submit hits orderRequestsApi.quickAdd
 * which creates an already-accepted order on the session, decrements
 * stock and broadcasts a `bill:updated` so the drawer refreshes.
 *
 * No "pending" intermediate state — staff doesn't want to confirm
 * something they themselves typed.
 */
function ProductsAddModal({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Record<number, ProductRecipeSlotView[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartUnits, setCartUnits] = useState<Record<number, CompositionPick[][]>>(
    {},
  );
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drill-down navigation: categories grid → products inside one
  // category. Mirrors the customer-facing OrderRequestCart so staff
  // and customers see the same shape.
  const [view, setView] = useState<
    { kind: "categories" } | { kind: "products"; category: string }
  >({ kind: "categories" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([productsApi.getAll(), productsApi.getRecipesBulk()])
      .then(([p, r]) => {
        if (cancelled) return;
        setProducts(p);
        setRecipes(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isArmable = (p: Product): boolean => {
    const r = recipes[p.id];
    if (!r || r.length === 0) return false;
    return r.some((slot) => slot.options.length > 1);
  };

  const isComposite = (p: Product): boolean => {
    const r = recipes[p.id];
    return Boolean(r && r.length > 0);
  };

  const bump = (p: Product, delta: number) => {
    if (delta > 0 && isArmable(p)) {
      setPickerProduct(p);
      return;
    }
    setCart((prev) => {
      const next = { ...prev };
      const current = next[p.id] ?? 0;
      // Compuestos no se topean por stock propio (no tienen);
      // simples sí. Backend re-valida igual.
      const cap = isComposite(p) ? Infinity : p.stock;
      const updated = Math.max(0, Math.min(current + delta, cap));
      if (updated === 0) {
        delete next[p.id];
      } else {
        next[p.id] = updated;
      }
      return next;
    });
    if (delta < 0 && isArmable(p)) {
      setCartUnits((prev) => {
        const list = prev[p.id] ?? [];
        if (list.length === 0) return prev;
        const sliced = list.slice(0, -1);
        const next = { ...prev };
        if (sliced.length === 0) delete next[p.id];
        else next[p.id] = sliced;
        return next;
      });
    }
  };

  const onPickerConfirmed = (composition: CompositionPick[]) => {
    const p = pickerProduct;
    if (!p) return;
    setCart((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? 0) + 1 }));
    setCartUnits((prev) => ({
      ...prev,
      [p.id]: [...(prev[p.id] ?? []), composition],
    }));
    setPickerProduct(null);
  };

  const cartEntries = Object.entries(cart)
    .map(([id, qty]) => ({ id: Number(id), qty }))
    .filter((e) => e.qty > 0);
  const totalUnits = cartEntries.reduce((acc, e) => acc + e.qty, 0);
  const totalAmount = cartEntries.reduce((acc, e) => {
    const p = products.find((x) => x.id === e.id);
    return acc + (p ? Number(p.price) * e.qty : 0);
  }, 0);

  // Group catalog by category for the simple drill-less list.
  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
    if (!p.is_active) return acc;
    (acc[p.category] = acc[p.category] ?? []).push(p);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  const submit = async () => {
    if (cartEntries.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = cartEntries.map((e) => {
        const p = products.find((x) => x.id === e.id);
        const units = cartUnits[e.id];
        if (p && isArmable(p) && units && units.length > 0) {
          return {
            product_id: e.id,
            units: units.map((composition) => ({
              composition: composition.map((slot) => ({
                slot_id: slot.slot_id,
                options: slot.options,
              })),
            })),
          };
        }
        return { product_id: e.id, quantity: e.qty };
      });
      await orderRequestsApi.quickAdd({
        table_session_id: sessionId,
        items,
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
      aria-label="Agregar productos"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        // stopPropagation: ver comentario en ActionModal. Mismo motivo —
        // el modal vive dentro de AdminBillDrawer.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: C.paper,
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
          maxHeight: "100%",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "18px 22px 12px",
            borderBottom: `1px solid ${C.sand}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {view.kind === "products" && (
            <button
              type="button"
              aria-label="Volver a categorías"
              onClick={() => setView({ kind: "categories" })}
              style={{
                background: "transparent",
                border: `1px solid ${C.sand}`,
                borderRadius: 999,
                width: 32,
                height: 32,
                fontFamily: FONT_DISPLAY,
                fontSize: 18,
                lineHeight: 1,
                color: C.cacao,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ←
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
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
              — {view.kind === "categories" ? "Cargar a la cuenta" : "Categoría"}
            </span>
            <h3
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 24,
                letterSpacing: 0.5,
                color: C.ink,
                margin: "2px 0 0",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {view.kind === "categories"
                ? "Agregar productos"
                : view.category}
            </h3>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {loading && (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              Cargando productos...
            </p>
          )}
          {!loading && categories.length === 0 && (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              Sin productos disponibles
            </p>
          )}

          {view.kind === "categories" && categories.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
              }}
            >
              {categories.map((cat) => {
                const items = grouped[cat] ?? [];
                const total = items.length;
                const available = items.filter((p) => {
                  // Compuestos: usar `availability` (server lo computa);
                  // simples: stock propio.
                  if (p.availability !== undefined) {
                    return p.availability === "available";
                  }
                  return p.stock > 0;
                }).length;
                const cartCount = items.reduce(
                  (acc, p) => acc + (cart[p.id] ?? 0),
                  0,
                );
                const allSoldOut = available === 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setView({ kind: "products", category: cat })}
                    style={{
                      position: "relative",
                      textAlign: "left",
                      padding: "14px 14px",
                      border: `1px solid ${allSoldOut ? C.sand : C.sandDark}`,
                      borderRadius: 14,
                      background: allSoldOut
                        ? C.cream
                        : `linear-gradient(160deg, ${C.paper} 0%, ${C.cream} 100%)`,
                      color: C.ink,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      minHeight: 86,
                      boxShadow:
                        "0 1px 0 rgba(43,29,20,0.04), 0 8px 22px -16px rgba(107,78,46,0.28)",
                      opacity: allSoldOut ? 0.6 : 1,
                      fontFamily: FONT_UI,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 18,
                        letterSpacing: 0.5,
                        color: C.ink,
                        textTransform: "uppercase",
                        lineHeight: 1.05,
                      }}
                    >
                      {cat}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        letterSpacing: 1.4,
                        color: C.mute,
                        textTransform: "uppercase",
                        fontWeight: 600,
                        marginTop: "auto",
                      }}
                    >
                      {allSoldOut ? (
                        <span style={{ color: C.burgundy }}>Agotada</span>
                      ) : available === total ? (
                        <>{total} productos</>
                      ) : (
                        <>
                          {available} disponibles · {total - available} agotados
                        </>
                      )}
                    </div>
                    {cartCount > 0 && (
                      <span
                        aria-label={`${cartCount} en carrito`}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          minWidth: 22,
                          height: 22,
                          padding: "0 7px",
                          borderRadius: 999,
                          background: `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
                          color: C.paper,
                          fontFamily: FONT_DISPLAY,
                          fontSize: 12,
                          letterSpacing: 0.5,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {cartCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {view.kind === "products" && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(grouped[view.category] ?? []).map((p) => {
                const qty = cart[p.id] ?? 0;
                // Compuestos: usar `availability`. Simples: stock propio.
                const isCompositeP = p.availability !== undefined;
                const soldOut = isCompositeP
                  ? p.availability === "out_of_stock"
                  : p.stock === 0;
                // Compuestos se topean en derived_stock (armables
                // según componentes). Simples: stock real.
                const atCap = isCompositeP
                  ? p.derived_stock !== undefined && qty >= p.derived_stock
                  : qty >= p.stock;
                return (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom: `1px solid ${C.sand}`,
                      opacity: soldOut ? 0.45 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: FONT_DISPLAY,
                          fontSize: 16,
                          color: C.ink,
                          letterSpacing: 0.3,
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          letterSpacing: 1,
                          color: C.gold,
                          marginTop: 2,
                        }}
                      >
                        {fmt(Number(p.price))}
                        {soldOut && (
                          <span style={{ marginLeft: 8, color: C.burgundy }}>
                            Agotado
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => bump(p, -1)}
                        disabled={qty === 0 || soldOut}
                        aria-label={`Quitar ${p.name}`}
                        style={stepperBtn(qty === 0 || soldOut)}
                      >
                        −
                      </button>
                      <span
                        style={{
                          minWidth: 22,
                          textAlign: "center",
                          fontFamily: FONT_DISPLAY,
                          fontSize: 16,
                          color: qty > 0 ? C.ink : C.mute,
                        }}
                      >
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => bump(p, 1)}
                        disabled={soldOut || atCap}
                        aria-label={`Agregar ${p.name}`}
                        style={stepperBtn(soldOut || atCap)}
                      >
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer
          style={{
            padding: "14px 18px",
            borderTop: `1px solid ${C.sand}`,
            background: C.cream,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2.5,
                color: C.mute,
                textTransform: "uppercase",
              }}
            >
              {totalUnits === 0
                ? "Carrito vacío"
                : `${totalUnits} ${totalUnits === 1 ? "producto" : "productos"}`}
            </span>
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                color: totalUnits === 0 ? C.mute : C.gold,
                letterSpacing: 1,
              }}
            >
              {fmt(totalAmount)}
            </span>
          </div>
          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: 8,
                background: C.burgundySoft,
                color: C.burgundy,
                borderRadius: 8,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 0.5,
              }}
            >
              {error}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <CancelButton onClick={onClose} busy={submitting} />
            <button
              type="button"
              onClick={submit}
              disabled={cartEntries.length === 0 || submitting}
              style={{
                padding: "10px 22px",
                border: "none",
                borderRadius: 999,
                background:
                  cartEntries.length === 0 || submitting
                    ? C.sand
                    : C.olive,
                color:
                  cartEntries.length === 0 || submitting ? C.mute : C.paper,
                fontFamily: FONT_DISPLAY,
                fontSize: 13,
                letterSpacing: 2.5,
                textTransform: "uppercase",
                cursor:
                  cartEntries.length === 0 || submitting
                    ? "not-allowed"
                    : "pointer",
                fontWeight: 600,
              }}
            >
              {submitting ? "Agregando..." : "Agregar a la cuenta"}
            </button>
          </div>
        </footer>
      </div>

      {pickerProduct && recipes[pickerProduct.id] && (
        <CompositionPicker
          productName={pickerProduct.name}
          slots={recipes[pickerProduct.id]}
          onCancel={() => setPickerProduct(null)}
          onPick={onPickerConfirmed}
          showStock
        />
      )}
    </div>
  );
}

function stepperBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 999,
    border: `1px solid ${disabled ? C.sand : C.gold}`,
    background: disabled ? C.cream : C.paper,
    color: disabled ? C.mute : C.ink,
    fontFamily: FONT_DISPLAY,
    fontSize: 18,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

// ─── Modal: anular sesión con razón ───────────────────────────────────────
//
// Sale al elegir "Anular sin cobrar" en una sesión con total > 0. Razón
// obligatoria (enum). Si elige "other" el detalle se vuelve obligatorio
// — el backend también lo enforce, pero validar acá ahorra un round-trip.
type VoidReason = "customer_left" | "admin_error" | "comp" | "other";

const VOID_REASONS: { key: VoidReason; label: string; hint: string }[] = [
  {
    key: "customer_left",
    label: "Cliente se fue sin pagar",
    hint: "El más común — se les escapó la cuenta.",
  },
  {
    key: "admin_error",
    label: "Sesión abierta por error",
    hint: "Mesa equivocada, doble apertura, etc.",
  },
  {
    key: "comp",
    label: "Cortesía de la casa",
    hint: "Invitación, mesa de prensa, etc.",
  },
  {
    key: "other",
    label: "Otro motivo",
    hint: "Requiere detalle escrito abajo.",
  },
];

function VoidReasonModal({
  tableNumber,
  totalPending,
  busy,
  onSubmit,
  onCancel,
}: {
  tableNumber: number | null;
  totalPending: number;
  busy: boolean;
  onSubmit: (body: { reason: VoidReason; other_detail?: string }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<VoidReason>("customer_left");
  const [detail, setDetail] = useState("");
  const detailRequired = reason === "other";
  const detailValid = !detailRequired || detail.trim().length >= 3;
  const canSubmit = !busy && detailValid;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Anular sesión sin cobro"
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
        // stopPropagation: ver comentario en ActionModal. Mismo motivo —
        // el modal vive dentro de AdminBillDrawer.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
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
            — Anular sin cobrar
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "4px 0 0",
            }}
          >
            {tableNumber != null ? `Mesa ${tableNumber}` : "Sesión"} ·
            pendiente {formatCop(totalPending)}
          </h3>
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: FONT_UI,
              fontSize: 13,
              lineHeight: 1.5,
              color: C.cacao,
            }}
          >
            La cuenta queda cerrada SIN cobro. Esto NO afecta el revenue del
            día (los productos ya entregados siguen contando como vendidos),
            pero deja registro auditable de la mesa anulada.{" "}
            <strong style={{ color: C.burgundy }}>
              No se puede deshacer.
            </strong>
          </p>
        </div>

        <fieldset
          style={{
            border: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <legend
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            Razón
          </legend>
          {VOID_REASONS.map((r) => {
            const active = reason === r.key;
            return (
              <label
                key={r.key}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${active ? C.ink : C.sand}`,
                  background: active ? C.parchment : C.paper,
                  borderRadius: 10,
                  cursor: "pointer",
                  transition:
                    "background 160ms cubic-bezier(0.16,1,0.3,1), border-color 160ms cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <input
                  type="radio"
                  name="void-reason"
                  value={r.key}
                  checked={active}
                  onChange={() => setReason(r.key)}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 14,
                      color: C.ink,
                      fontWeight: 700,
                    }}
                  >
                    {r.label}
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.mute,
                      letterSpacing: 0.4,
                      marginTop: 2,
                    }}
                  >
                    {r.hint}
                  </div>
                </div>
              </label>
            );
          })}
        </fieldset>

        {detailRequired && (
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
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
              Detalle (obligatorio)
            </span>
            <textarea
              autoFocus
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Ej: cliente discutió la cuenta, decidí no cobrar"
              minLength={3}
              maxLength={200}
              rows={2}
              style={{
                padding: "8px 10px",
                border: `1px solid ${C.sand}`,
                borderRadius: 8,
                background: C.paper,
                color: C.ink,
                fontFamily: FONT_UI,
                fontSize: 13,
                resize: "vertical",
                outline: "none",
              }}
            />
          </label>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 4,
          }}
        >
          <CancelButton
            onClick={onCancel}
            busy={busy}
            style={{ flex: 1, fontSize: 13, letterSpacing: 0.5 }}
          />
          <button
            type="button"
            onClick={() =>
              onSubmit({
                reason,
                other_detail: detailRequired ? detail.trim() : undefined,
              })
            }
            disabled={!canSubmit}
            className="crown-btn crown-btn-primary"
            style={{
              flex: 1.4,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: canSubmit ? C.burgundy : C.sand,
              color: canSubmit ? C.paper : C.mute,
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 800,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {busy ? "Anulando…" : "Anular sin cobrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Modal: cobrar con método de pago (Fase A+ B3) ────────────────────────
/**
 * Reemplaza el ConfirmModal simple del flujo "Cobrar y cerrar".
 * Fuerza al cajero a declarar el método antes de confirmar — sin
 * default invisible, sin "asumir efectivo".
 *
 * Hoy soporta UN solo método por cobro (el monto es el pendiente
 * completo). Cobros divididos vienen en B3.5: este mismo modal
 * crece para aceptar N filas y validar sum == pendiente.
 */
// Una fila de split en el modal de cobrar y cerrar. `method` es null
// hasta que el cajero elige; `amountStr` es el string del input crudo
// (preservamos el string original para no perder ceros a la derecha
// mientras el usuario tipea).
type SplitRow = {
  id: number;
  method: PaymentMethod | null;
  amountStr: string;
};

function MarkPaidModal({
  accountLabel,
  pending,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  accountLabel: string;
  pending: number;
  busy: boolean;
  error: string | null;
  onConfirm: (payments: MarkPaidPaymentInput[]) => void;
  onCancel: () => void;
}) {
  // Estado: array de filas { method, amount }. Empezamos con UNA fila
  // y monto pre-cargado = pendiente. El cajero puede agregar más filas
  // para cobros divididos ("$30k tarjeta + $20k efectivo").
  const [rows, setRows] = useState<SplitRow[]>(() => [
    { id: 1, method: null, amountStr: String(Math.round(pending)) },
  ]);

  // Próximo id (no reuso ids de filas removidas para evitar problemas
  // de key en React si se agrega/quita rápido).
  const [nextId, setNextId] = useState(2);

  const updateRow = (id: number, patch: Partial<Omit<SplitRow, "id">>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  const addRow = () => {
    // Pre-cargar el monto faltante para que el cajero solo tenga que
    // elegir método. Si la suma actual ya cubre, agregamos fila con 0
    // (caso raro; igual permitimos por flexibilidad).
    const sumNow = rows.reduce((acc, r) => acc + (Number(r.amountStr) || 0), 0);
    const remaining = Math.max(0, Math.round(pending - sumNow));
    setRows((prev) => [
      ...prev,
      { id: nextId, method: null, amountStr: String(remaining) },
    ]);
    setNextId((n) => n + 1);
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const sum = rows.reduce((acc, r) => acc + (Number(r.amountStr) || 0), 0);
  const sumMatches = Math.abs(sum - pending) < 0.5;
  const allMethodsChosen = rows.every((r) => r.method !== null);
  const allAmountsValid = rows.every(
    (r) =>
      r.amountStr.trim().length > 0 &&
      Number.isFinite(Number(r.amountStr)) &&
      Number(r.amountStr) > 0,
  );
  const canSubmit =
    !busy && allMethodsChosen && allAmountsValid && sumMatches;

  const submit = () => {
    if (!canSubmit) return;
    // Mapeamos a MarkPaidPaymentInput[]. allMethodsChosen garantiza
    // que ningún method es null, pero el cast explícito calma a TS.
    onConfirm(
      rows.map((r) => ({
        method: r.method as PaymentMethod,
        amount: Number(r.amountStr),
      })),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Cobrar y cerrar cuenta"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 20,
      }}
    >
      <div
        // stopPropagation: ver comentario en ActionModal. Mismo motivo —
        // el modal vive dentro de AdminBillDrawer.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
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
              color: C.olive,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Cobrar y cerrar
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "4px 0 0",
            }}
          >
            {accountLabel}
          </h3>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "12px 14px",
            background: C.cream,
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
            }}
          >
            Total a cobrar
          </span>
          <strong
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              color: C.ink,
              letterSpacing: 0.5,
            }}
          >
            {formatCop(pending)}
          </strong>
        </div>

        {/* Lista de filas { método + monto }. Si solo hay 1, no se
            muestra el botón de remover. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row, idx) => (
            <div
              key={row.id}
              style={{
                padding: 12,
                border: `1px solid ${C.sand}`,
                borderRadius: 10,
                background: C.cream,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
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
                  Pago {idx + 1}
                </span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    disabled={busy}
                    aria-label="Quitar este pago"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: C.burgundy,
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      cursor: busy ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      padding: "2px 6px",
                    }}
                  >
                    × Quitar
                  </button>
                )}
              </div>
              <PaymentMethodSelector
                value={row.method}
                onChange={(m) => updateRow(row.id, { method: m })}
                disabled={busy}
                compact
              />
              <input
                type="number"
                inputMode="numeric"
                value={row.amountStr}
                onChange={(e) =>
                  updateRow(row.id, { amountStr: e.target.value })
                }
                placeholder="0"
                disabled={busy}
                style={{
                  padding: "8px 12px",
                  border: `1px solid ${C.sand}`,
                  borderRadius: 8,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  background: C.paper,
                  color: C.ink,
                  outline: "none",
                  width: "100%",
                }}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          disabled={busy}
          style={{
            padding: "8px 14px",
            border: `1px dashed ${C.sand}`,
            borderRadius: 10,
            background: "transparent",
            color: C.cacao,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            cursor: busy ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          + Agregar otro método
        </button>

        {/* Indicador de suma en vivo. Verde si cuadra, rojo si no. */}
        <div
          style={{
            padding: "10px 14px",
            background: sumMatches ? C.oliveSoft : C.burgundySoft,
            border: `1px solid ${sumMatches ? C.olive : C.burgundy}`,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.ink,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ letterSpacing: 1.5, textTransform: "uppercase" }}>
            Suma de pagos
          </span>
          <strong>
            {formatCop(sum)} / {formatCop(pending)}
            {sumMatches ? " ·  cuadra" : ` · faltan ${formatCop(pending - sum)}`}
          </strong>
        </div>

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
          <CancelButton onClick={onCancel} busy={busy} />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit ? C.olive : C.mute,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {busy ? "Cobrando..." : "Sí, cobrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lista de Payments + acción Reversar (Fase A+ B3.7) ────────────────────

/**
 * Render de los cobros (parciales, finales) y reversos asociados a la
 * sesión. Por fila muestra: método, kind, monto (con signo en reversos),
 * timestamp, autor; en reversos también la razón. La acción "Reversar"
 * solo aparece en filas elegibles (no reversal y sin reverso previo).
 */
function PaymentsList({
  payments,
  onReverse,
}: {
  payments: Payment[];
  onReverse: (p: Payment) => void;
}) {
  // Set de ids reversados: para cada fila kind=reversal, su `reverses_id`
  // apunta al Payment original ya anulado. Lo usamos para deshabilitar
  // "Reversar" en filas ya con reverso.
  const reversedIds = new Set<number>();
  for (const p of payments) {
    if (p.kind === "reversal" && p.reverses_id != null) {
      reversedIds.add(p.reverses_id);
    }
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h4
        style={{
          margin: 0,
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        — Pagos registrados
      </h4>
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
        {payments.map((p) => {
          const isReversal = p.kind === "reversal";
          const alreadyReversed = reversedIds.has(p.id);
          // Reverso de Payment SÍ se permite en mesas cerradas: Bold
          // puede rechazar la tarjeta minutos después del cierre, el
          // cliente puede reclamar al día siguiente, o se descubre un
          // doble cobro al hacer la conciliación. El backend solo
          // exige que la jornada de caja esté abierta — alineamos la
          // UI a esa misma regla y no dependemos de readOnly.
          const canReverse = !isReversal && !alreadyReversed;
          return (
            <li
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: isReversal ? C.burgundySoft : C.cream,
                border: `1px solid ${isReversal ? C.burgundy : C.sand}`,
                borderRadius: 10,
                opacity: alreadyReversed ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 13,
                    color: C.ink,
                    fontWeight: 700,
                  }}
                >
                  {paymentMethodLabel(p.method)} ·{" "}
                  {paymentKindLabel(p.kind)}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 0.5,
                    color: C.mute,
                  }}
                >
                  {formatPaymentTimestamp(p.created_at)}
                  {p.created_by ? ` · ${p.created_by}` : ""}
                  {alreadyReversed ? " · reversado" : ""}
                </span>
                {isReversal && p.reverse_reason && (
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      letterSpacing: 0.5,
                      color: C.burgundy,
                      marginTop: 2,
                    }}
                  >
                    Razón: {reverseReasonLabel(p.reverse_reason)}
                    {p.reverse_reason_detail
                      ? ` — ${p.reverse_reason_detail}`
                      : ""}
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
                    color: isReversal ? C.burgundy : C.ink,
                    letterSpacing: 0.5,
                  }}
                >
                  {p.amount < 0 ? "−" : ""}
                  {formatCop(Math.abs(p.amount))}
                </strong>
                {canReverse && (
                  <button
                    type="button"
                    onClick={() => onReverse(p)}
                    style={{
                      padding: "4px 10px",
                      border: `1px solid ${C.burgundy}`,
                      background: "transparent",
                      color: C.burgundy,
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
    </section>
  );
}

function paymentMethodLabel(m: PaymentMethod): string {
  if (m === "efectivo") return "Efectivo";
  if (m === "tarjeta_bold") return "Tarjeta Bold";
  if (m === "qr_bold") return "QR Bold";
  return m;
}

function paymentKindLabel(k: "partial" | "final" | "reversal"): string {
  if (k === "partial") return "Parcial";
  if (k === "final") return "Final";
  if (k === "reversal") return "Reverso";
  return k;
}

function reverseReasonLabel(r: PaymentReverseReason): string {
  switch (r) {
    case "bold_rejected":
      return "Bold rechazó la tarjeta";
    case "wrong_session":
      return "Cobro a mesa equivocada";
    case "double_charge":
      return "Doble cobro";
    case "customer_refund":
      return "Devolución al cliente";
    case "test_operation":
      return "Operación de prueba";
    case "staff_error":
      return "Error del staff";
    case "other":
      return "Otro";
  }
}

function formatPaymentTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}

// ─── Modal: reversar Payment con razón (Fase A+ B3.7) ──────────────────────

const REVERSE_REASONS: ReadonlyArray<{
  key: PaymentReverseReason;
  label: string;
}> = [
  { key: "bold_rejected", label: "Bold rechazó la tarjeta" },
  { key: "wrong_session", label: "Cobro a mesa equivocada" },
  { key: "double_charge", label: "Doble cobro accidental" },
  { key: "customer_refund", label: "Devolución al cliente" },
  { key: "test_operation", label: "Operación de prueba" },
  { key: "staff_error", label: "Error del staff" },
  { key: "other", label: "Otro motivo" },
];

function ReversePaymentModal({
  payment,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  payment: Payment;
  busy: boolean;
  error: string | null;
  onConfirm: (body: {
    reason: PaymentReverseReason;
    reason_detail?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<PaymentReverseReason | null>(null);
  const [detail, setDetail] = useState("");

  // Escape cierra. Mismo patrón que ModalShell del CashRegisterBanner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const needsDetail = reason === "other";
  const detailValid = !needsDetail || detail.trim().length >= 3;
  const canSubmit = reason !== null && detailValid && !busy;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Reversar cobro"
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
        // stopPropagation: ver comentario en ActionModal. Mismo motivo —
        // el modal vive dentro de AdminBillDrawer.
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
              color: C.burgundy,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Reversar cobro
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
            {paymentMethodLabel(payment.method)} · {formatCop(payment.amount)}
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
            El cobro original NO se borra. Se crea una fila de reverso con
            el monto opuesto, queda en la auditoría y se descuenta del
            cuadre de caja de la jornada actual.
          </p>
        </div>

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
            — Motivo
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {REVERSE_REASONS.map((r) => {
              const selected = reason === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReason(r.key)}
                  disabled={busy}
                  aria-pressed={selected}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: selected ? C.burgundySoft : C.cream,
                    border: `1px solid ${selected ? C.burgundy : C.sand}`,
                    borderRadius: 10,
                    fontFamily: FONT_UI,
                    fontSize: 13,
                    color: selected ? C.burgundy : C.ink,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontWeight: selected ? 700 : 500,
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {needsDetail && (
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
              Detalle (obligatorio, mín. 3 caracteres)
            </span>
            <input
              type="text"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Describe brevemente el motivo del reverso"
              maxLength={500}
              disabled={busy}
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
        )}

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
          <CancelButton onClick={onCancel} busy={busy} />
          <button
            type="button"
            onClick={() => {
              if (reason !== null) {
                onConfirm({
                  reason,
                  reason_detail: needsDetail ? detail.trim() : undefined,
                });
              }
            }}
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
            {busy ? "Reversando..." : "Reversar"}
          </button>
        </div>
      </div>
    </div>
  );
}
