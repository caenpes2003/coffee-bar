"use client";

/**
 * Modal compartido para elegir la composición de UNA unidad de un
 * producto compuesto armable. Se usa tanto desde el cart del cliente
 * (mesa) como del admin (carga rápida de productos en una cuenta).
 *
 * Comportamiento:
 *   - Una pantalla por cada slot del producto (drill-less; se
 *     muestran apilados con header).
 *   - Por cada slot: lista de opciones con stepper +/-.
 *   - Suma de cantidades por slot debe igualar slot.quantity.
 *     Si no, "Agregar" queda deshabilitado y se muestra
 *     "X/Y" en rojo.
 *   - Valores iniciales: los `default_quantity` de cada opción.
 *
 * Output:
 *   - Al "Agregar", llama `onPick(composition)` donde composition es:
 *     [{ slot_id, options: [{ option_id, quantity }] }]
 *   - El llamador decide qué hacer con eso (agregar al cart, etc.).
 *
 * Stock awareness:
 *   - Cada opción incluye `component.stock`. Si la suma elegida
 *     supera el stock real, el modal NO bloquea (el backend valida);
 *     muestra una advertencia visual.
 */

import { useMemo, useState } from "react";
import type { ProductRecipeSlotView } from "@/lib/api/services";

export interface CompositionPick {
  slot_id: number;
  options: Array<{ option_id: number; quantity: number }>;
}

interface Props {
  productName: string;
  slots: ProductRecipeSlotView[];
  onCancel: () => void;
  onPick: (composition: CompositionPick[]) => void;
}

type SlotState = Map<number, number>; // option_id -> quantity

export function CompositionPicker({
  productName,
  slots,
  onCancel,
  onPick,
}: Props) {
  // Estado: por cada slot, un map option_id → quantity inicializado con defaults.
  const [state, setState] = useState<Map<number, SlotState>>(() => {
    const init = new Map<number, SlotState>();
    for (const slot of slots) {
      const inner = new Map<number, number>();
      for (const opt of slot.options) {
        inner.set(opt.id, opt.default_quantity);
      }
      init.set(slot.id, inner);
    }
    return init;
  });

  const sumsBySlot = useMemo(() => {
    const sums = new Map<number, number>();
    for (const slot of slots) {
      const inner = state.get(slot.id);
      let total = 0;
      if (inner) for (const v of inner.values()) total += v;
      sums.set(slot.id, total);
    }
    return sums;
  }, [state, slots]);

  const allSlotsValid = slots.every(
    (s) => (sumsBySlot.get(s.id) ?? -1) === s.quantity,
  );

  const updateOption = (slotId: number, optionId: number, delta: number) => {
    setState((prev) => {
      const next = new Map(prev);
      const slotMap = new Map(next.get(slotId) ?? new Map());
      const current = slotMap.get(optionId) ?? 0;
      const updated = Math.max(0, current + delta);
      slotMap.set(optionId, updated);
      next.set(slotId, slotMap as SlotState);
      return next;
    });
  };

  const handlePick = () => {
    if (!allSlotsValid) return;
    const composition: CompositionPick[] = slots.map((slot) => {
      const inner = state.get(slot.id)!;
      return {
        slot_id: slot.id,
        options: Array.from(inner.entries())
          .filter(([, q]) => q > 0)
          .map(([option_id, quantity]) => ({ option_id, quantity })),
      };
    });
    onPick(composition);
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`Elegir mezcla para ${productName}`}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "85dvh",
          background: "#FFFDF8",
          borderRadius: "20px 20px 0 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 -20px 60px -20px rgba(43,29,20,0.45)",
        }}
      >
        <header
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid #F1E6D2",
          }}
        >
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
            — Elegí la mezcla
          </span>
          <h2
            style={{
              fontFamily: "var(--font-bebas)",
              fontSize: 24,
              letterSpacing: 1,
              color: "#2B1D14",
              margin: "4px 0 0",
              lineHeight: 1.1,
              textTransform: "uppercase",
            }}
          >
            {productName}
          </h2>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 22px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {slots.map((slot) => {
            const sum = sumsBySlot.get(slot.id) ?? 0;
            const valid = sum === slot.quantity;
            return (
              <section key={slot.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-oswald)",
                      fontSize: 10,
                      letterSpacing: 2,
                      color: "#6B4E2E",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    {slot.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-bebas)",
                      fontSize: 18,
                      color: valid ? "#6B7E4A" : "#8B2635",
                      letterSpacing: 0.5,
                    }}
                  >
                    {sum} / {slot.quantity}
                  </span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {slot.options.map((option) => {
                    const qty =
                      state.get(slot.id)?.get(option.id) ?? 0;
                    const stockOk = option.component.stock >= qty;
                    return (
                      <li
                        key={option.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 0",
                          borderBottom: "1px solid #F8F1E4",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily: "var(--font-bebas)",
                              fontSize: 16,
                              color: "#2B1D14",
                              letterSpacing: 0.3,
                            }}
                          >
                            {option.component.name}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-oswald)",
                              fontSize: 9,
                              color: stockOk ? "#A89883" : "#8B2635",
                              letterSpacing: 0.8,
                              marginTop: 2,
                            }}
                          >
                            Stock disponible: {option.component.stock}
                            {!stockOk && " — stock insuficiente"}
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
                            onClick={() =>
                              updateOption(slot.id, option.id, -1)
                            }
                            disabled={qty === 0}
                            aria-label={`Quitar ${option.component.name}`}
                            style={stepperBtn(qty === 0)}
                          >
                            −
                          </button>
                          <span
                            style={{
                              fontFamily: "var(--font-bebas)",
                              fontSize: 16,
                              minWidth: 22,
                              textAlign: "center",
                              color: qty > 0 ? "#2B1D14" : "#A89883",
                            }}
                          >
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateOption(slot.id, option.id, 1)
                            }
                            disabled={sum >= slot.quantity}
                            aria-label={`Sumar ${option.component.name}`}
                            style={stepperBtn(sum >= slot.quantity)}
                          >
                            +
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <footer
          style={{
            padding: "12px 22px 18px",
            borderTop: "1px solid #F1E6D2",
            background: "#FDF8EC",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 18px",
              border: "1px solid #F1E6D2",
              background: "transparent",
              color: "#6B4E2E",
              borderRadius: 999,
              fontFamily: "var(--font-oswald)",
              fontSize: 11,
              letterSpacing: 2,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handlePick}
            disabled={!allSlotsValid}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: allSlotsValid
                ? "linear-gradient(135deg, #B8894A 0%, #C9944F 100%)"
                : "#F1E6D2",
              color: allSlotsValid ? "#FFFDF8" : "#A89883",
              fontFamily: "var(--font-bebas)",
              fontSize: 14,
              letterSpacing: 2.5,
              cursor: allSlotsValid ? "pointer" : "not-allowed",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Agregar al carrito
          </button>
        </footer>
      </div>
    </div>
  );
}

function stepperBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 999,
    border: `1px solid ${disabled ? "#F1E6D2" : "#B8894A"}`,
    background: disabled ? "#F8F1E4" : "#FFFDF8",
    color: disabled ? "#A89883" : "#2B1D14",
    fontFamily: "var(--font-bebas)",
    fontSize: 18,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
