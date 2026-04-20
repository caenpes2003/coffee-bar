"use client";

/**
 * Customer cart for building an OrderRequest.
 *
 * Strict separation (Phase F1b):
 *   - Catalog (products)   → backend, read from the store.
 *   - Cart items           → local state only. Not persisted. Dies on close/submit.
 *   - Submitted requests   → backend + socket. We do NOT read them here.
 *   - Active orders        → backend + socket. We do NOT read them here.
 *
 * Submit calls POST /order-requests. On success the modal closes. The bill
 * and "mis pedidos" views update independently via their own socket paths.
 */
import { useEffect, useMemo, useState } from "react";
import { orderRequestsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { Product } from "@coffee-bar/shared";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

type CartState = Record<number, number>; // product_id -> quantity

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  tableSessionId: number;
  products: Product[];
}

export function OrderRequestCart({
  open,
  onClose,
  onSubmitted,
  tableSessionId,
  products,
}: Props) {
  const [cart, setCart] = useState<CartState>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset on open: cart is ephemeral and must not leak between openings.
    if (open) {
      setCart({});
      setError(null);
    }
  }, [open]);

  const cartEntries = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ id: Number(id), qty }))
        .filter((e) => e.qty > 0),
    [cart],
  );

  const estimatedTotal = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return cartEntries.reduce((acc, e) => {
      const p = byId.get(e.id);
      if (!p) return acc;
      return acc + Number(p.price) * e.qty;
    }, 0);
  }, [cartEntries, products]);

  const bump = (product: Product, delta: number) => {
    setCart((prev) => {
      const current = prev[product.id] ?? 0;
      const next = Math.max(0, current + delta);
      // Cap locally at stock to avoid obvious errors. Backend re-validates.
      const capped = Math.min(next, product.stock);
      if (capped === current) return prev;
      const updated = { ...prev, [product.id]: capped };
      if (capped === 0) delete updated[product.id];
      return updated;
    });
  };

  const submit = async () => {
    if (cartEntries.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await orderRequestsApi.create({
        table_session_id: tableSessionId,
        items: cartEntries.map((e) => ({ product_id: e.id, quantity: e.qty })),
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const byCategory = new Map<string, Product[]>();
  for (const p of products) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Pedir productos"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
        padding: 0,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 540,
          maxHeight: "92dvh",
          background: "#FFFDF8",
          borderRadius: "20px 20px 0 0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -20px 60px -20px rgba(43,29,20,0.45)",
        }}
      >
        <header
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid #F1E6D2",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "var(--font-oswald)",
                fontSize: 10,
                letterSpacing: 3,
                color: "#A89883",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Pedir
            </span>
            <h2
              style={{
                fontFamily: "var(--font-bebas)",
                fontSize: 28,
                letterSpacing: 1,
                color: "#2B1D14",
                margin: 0,
                lineHeight: 1,
              }}
            >
              Carta
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "1px solid #F1E6D2",
              borderRadius: 999,
              width: 36,
              height: 36,
              fontSize: 18,
              color: "#6B4E2E",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </header>

        <div style={{ overflowY: "auto", padding: "14px 22px 18px" }}>
          {Array.from(byCategory.entries()).map(([category, items]) => (
            <section key={category} style={{ marginBottom: 18 }}>
              <h3
                style={{
                  fontFamily: "var(--font-oswald)",
                  fontSize: 10,
                  letterSpacing: 3,
                  color: "#A89883",
                  textTransform: "uppercase",
                  margin: "0 0 10px",
                  fontWeight: 700,
                }}
              >
                {category}
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {items.map((p) => {
                  const qty = cart[p.id] ?? 0;
                  const soldOut = !p.is_active || p.stock === 0;
                  const atCap = qty >= p.stock;
                  return (
                    <li
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 0",
                        borderBottom: "1px solid #F8F1E4",
                        opacity: soldOut ? 0.5 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--font-bebas)",
                            fontSize: 18,
                            color: "#2B1D14",
                            letterSpacing: 0.4,
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-oswald)",
                            fontSize: 11,
                            color: "#B8894A",
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          {fmt(Number(p.price))}
                          {soldOut && (
                            <span style={{ marginLeft: 10, color: "#8B2635" }}>
                              Agotado
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => bump(p, -1)}
                          disabled={qty === 0 || soldOut}
                          aria-label={`Quitar ${p.name}`}
                          style={stepperStyle(qty === 0 || soldOut)}
                        >
                          −
                        </button>
                        <span
                          style={{
                            fontFamily: "var(--font-bebas)",
                            fontSize: 18,
                            minWidth: 22,
                            textAlign: "center",
                            color: qty > 0 ? "#2B1D14" : "#A89883",
                          }}
                        >
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => bump(p, 1)}
                          disabled={soldOut || atCap}
                          aria-label={`Agregar ${p.name}`}
                          style={stepperStyle(soldOut || atCap)}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {products.length === 0 && (
            <p
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: "var(--font-oswald)",
                fontSize: 11,
                color: "#A89883",
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              No hay productos disponibles
            </p>
          )}
        </div>

        <footer
          style={{
            padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
            borderTop: "1px solid #F1E6D2",
            background: "#FDF8EC",
          }}
        >
          {error && (
            <p
              role="alert"
              style={{
                margin: "0 0 10px",
                fontFamily: "var(--font-oswald)",
                fontSize: 11,
                color: "#8B2635",
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
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-oswald)",
                fontSize: 10,
                letterSpacing: 3,
                color: "#A89883",
                textTransform: "uppercase",
              }}
            >
              Estimado
            </span>
            <span
              style={{
                fontFamily: "var(--font-bebas)",
                fontSize: 26,
                color: "#B8894A",
                letterSpacing: 1,
              }}
            >
              {fmt(estimatedTotal)}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={cartEntries.length === 0 || submitting}
            style={{
              width: "100%",
              padding: "16px 20px",
              border: "none",
              borderRadius: 999,
              background:
                cartEntries.length === 0 || submitting
                  ? "#F1E6D2"
                  : "linear-gradient(135deg, #B8894A 0%, #C9944F 100%)",
              color:
                cartEntries.length === 0 || submitting ? "#A89883" : "#FFFDF8",
              fontFamily: "var(--font-bebas)",
              fontSize: 16,
              letterSpacing: 3,
              textTransform: "uppercase",
              cursor:
                cartEntries.length === 0 || submitting
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {submitting ? "Enviando..." : "Enviar pedido"}
          </button>
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-oswald)",
              fontSize: 10,
              color: "#A89883",
              letterSpacing: 1.5,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Tu pedido será revisado por el bar antes de prepararse.
          </p>
        </footer>
      </div>
    </div>
  );
}

function stepperStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 999,
    border: `1px solid ${disabled ? "#F1E6D2" : "#B8894A"}`,
    background: disabled ? "#F8F1E4" : "#FFFDF8",
    color: disabled ? "#A89883" : "#2B1D14",
    fontFamily: "var(--font-bebas)",
    fontSize: 20,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
