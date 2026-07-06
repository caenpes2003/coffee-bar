"use client";

/**
 * Editor de receta de un producto compuesto. Se monta como sección
 * dentro del modo Edit del panel de productos.
 *
 * Estado interno:
 *   - `slots`: estructura WIP que el operador está armando.
 *   - `dirty`: flag para mostrar el botón de guardar habilitado.
 *
 * Validación local (live):
 *   - Cada slot debe tener al menos 1 opción.
 *   - Cada opción debe tener un componente seleccionado.
 *   - Sin duplicar componente dentro de un mismo slot.
 *   - Suma de default_quantity por slot debe igualar quantity.
 *
 * Persistencia:
 *   - Botón "Guardar receta" envía un PUT al backend.
 *   - El backend revalida + transacción.
 *   - Vacío (slots=[]) borra la receta → producto se vuelve simple.
 */

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Product } from "@coffee-bar/shared";
import {
  adminProductsApi,
  type ProductRecipeSlotView,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI } from "@/lib/theme";

interface Props {
  productId: number;
  allProducts: Product[];
}

interface SlotState {
  // Si tiene `id`, viene del backend; null = nuevo slot local sin
  // persistir. No usamos el id para nada del UI — la clave del map es
  // la posición en el array. Sólo para depurar.
  id: number | null;
  label: string;
  quantity: number;
  options: OptionState[];
}

interface OptionState {
  id: number | null;
  component_id: number | null;
  default_quantity: number;
}

const inputBase: React.CSSProperties = {
  padding: "8px 10px",
  border: `1px solid ${C.sand}`,
  borderRadius: 8,
  background: C.paper,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 13,
  outline: "none",
};

export function ProductRecipeEditor({ productId, allProducts }: Props) {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [originalSlots, setOriginalSlots] = useState<SlotState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Productos que pueden usarse como componentes:
  //   - is_active = true
  //   - id distinto al del producto que estamos editando (no auto-ref)
  // El backend rechaza si el componente es compuesto, pero acá no
  // tenemos esa info por producto sin pedirle. Lo dejamos al backend.
  const eligibleComponents = useMemo(
    () =>
      allProducts
        .filter((p) => p.is_active && p.id !== productId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allProducts, productId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminProductsApi.getRecipe(productId);
      const snapshot = serverToState(data);
      setSlots(snapshot);
      setOriginalSlots(snapshot);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(originalSlots),
    [slots, originalSlots],
  );

  const slotErrors = useMemo(() => validateSlots(slots), [slots]);
  const hasErrors = slotErrors.some((e) => e !== null);
  const canSave = dirty && !hasErrors && !saving;

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: null,
        label: prev.length === 0 ? "Cervezas" : `Slot ${prev.length + 1}`,
        quantity: 6,
        options: [{ id: null, component_id: null, default_quantity: 6 }],
      },
    ]);
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, patch: Partial<SlotState>) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const addOption = (slotIdx: number) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? {
              ...s,
              options: [
                ...s.options,
                { id: null, component_id: null, default_quantity: 0 },
              ],
            }
          : s,
      ),
    );
  };

  const removeOption = (slotIdx: number, optIdx: number) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? { ...s, options: s.options.filter((_, j) => j !== optIdx) }
          : s,
      ),
    );
  };

  const updateOption = (
    slotIdx: number,
    optIdx: number,
    patch: Partial<OptionState>,
  ) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? {
              ...s,
              options: s.options.map((o, j) =>
                j === optIdx ? { ...o, ...patch } : o,
              ),
            }
          : s,
      ),
    );
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = slots.map((s) => ({
        label: s.label.trim(),
        quantity: s.quantity,
        options: s.options.map((o) => ({
          component_id: o.component_id!,
          default_quantity: o.default_quantity,
        })),
      }));
      const refreshed = await adminProductsApi.putRecipe(productId, payload);
      const snapshot = serverToState(refreshed);
      setSlots(snapshot);
      setOriginalSlots(snapshot);
      setSuccess(
        snapshot.length === 0
          ? "Receta eliminada. Producto vuelve a ser simple."
          : "Receta guardada.",
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: `1px solid ${C.sand}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 2.5,
            color: C.cacao,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          Composición
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.mute,
            letterSpacing: 0.5,
          }}
        >
          {loading
            ? "Cargando..."
            : slots.length === 0
              ? "Producto simple"
              : `${slots.length} slot(s)`}
        </span>
      </div>

      {loading ? null : slots.length === 0 ? (
        <div
          style={{
            padding: "10px 12px",
            border: `1px dashed ${C.sand}`,
            borderRadius: 10,
            background: C.cream,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          Este producto se vende como una unidad simple — al pedirse,
          descuenta 1 unidad de su propio stock. Para convertirlo en
          un compuesto (cubetazo, sixpack, combo), agregá uno o más
          slots con sus componentes.
        </div>
      ) : (
        slots.map((slot, idx) => (
          <SlotEditor
            key={idx}
            slot={slot}
            index={idx}
            error={slotErrors[idx]}
            eligible={eligibleComponents}
            onChange={(patch) => updateSlot(idx, patch)}
            onRemove={() => removeSlot(idx)}
            onAddOption={() => addOption(idx)}
            onRemoveOption={(j) => removeOption(idx, j)}
            onUpdateOption={(j, p) => updateOption(idx, j, p)}
          />
        ))
      )}

      {!loading && slots.length > 0 && (
        <DerivedStockPreview slots={slots} allProducts={allProducts} />
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={addSlot}
          style={{
            padding: "6px 12px",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            color: C.cacao,
            background: C.paper,
            border: `1px solid ${C.sand}`,
            borderRadius: 999,
            cursor: "pointer",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          + Slot
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          style={{
            padding: "6px 14px",
            fontFamily: FONT_DISPLAY,
            fontSize: 12,
            letterSpacing: 2,
            color: canSave ? C.paper : C.mute,
            background: canSave
              ? `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`
              : C.sand,
            border: "none",
            borderRadius: 999,
            cursor: canSave ? "pointer" : "not-allowed",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {saving
            ? "Guardando..."
            : slots.length === 0 && originalSlots.length > 0
              ? "Quitar receta"
              : "Guardar receta"}
        </button>
        {dirty && !saving && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.mute,
              letterSpacing: 0.5,
            }}
          >
            Cambios sin guardar
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 8,
            background: C.terracottaSoft,
            color: C.terracotta,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: 8,
            background: `${C.olive}11`,
            color: C.olive,
            border: `1px solid ${C.olive}55`,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          {success}
        </p>
      )}
    </div>
  );
}

function SlotEditor({
  slot,
  index,
  error,
  eligible,
  onChange,
  onRemove,
  onAddOption,
  onRemoveOption,
  onUpdateOption,
}: {
  slot: SlotState;
  index: number;
  error: string | null;
  eligible: Product[];
  onChange: (patch: Partial<SlotState>) => void;
  onRemove: () => void;
  onAddOption: () => void;
  onRemoveOption: (optIdx: number) => void;
  onUpdateOption: (optIdx: number, patch: Partial<OptionState>) => void;
}) {
  const sumDefaults = slot.options.reduce(
    (acc, o) => acc + (o.default_quantity || 0),
    0,
  );
  const slotMatchesTotal = sumDefaults === slot.quantity;

  return (
    <div
      style={{
        padding: "10px 12px",
        border: `1px solid ${error ? C.terracotta : C.sand}`,
        borderRadius: 10,
        background: C.cream,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.mute,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            minWidth: 28,
          }}
        >
          #{index + 1}
        </span>
        <input
          type="text"
          value={slot.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Etiqueta (ej. Cervezas)"
          maxLength={60}
          style={{ ...inputBase, flex: 1, minWidth: 0 }}
        />
        <input
          type="number"
          min={1}
          step={1}
          value={slot.quantity}
          onChange={(e) =>
            onChange({
              quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
          style={{ ...inputBase, width: 60, textAlign: "right" }}
          aria-label="Cantidad total del slot"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Eliminar slot"
          title="Eliminar slot"
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${C.sand}`,
            background: C.paper,
            color: C.mute,
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Suma de defaults vs quantity */}
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: slotMatchesTotal ? C.olive : C.terracotta,
          letterSpacing: 0.5,
        }}
      >
        Suma defaults: {sumDefaults} / {slot.quantity}{" "}
        {slotMatchesTotal ? "✓" : "(debe coincidir)"}
      </div>

      {slot.options.map((option, optIdx) => (
        <OptionEditor
          key={optIdx}
          option={option}
          eligible={eligible}
          usedComponentIds={new Set(
            slot.options
              .filter((_, i) => i !== optIdx)
              .map((o) => o.component_id)
              .filter((id): id is number => id != null),
          )}
          onChange={(patch) => onUpdateOption(optIdx, patch)}
          onRemove={() => onRemoveOption(optIdx)}
          canRemove={slot.options.length > 1}
        />
      ))}

      <button
        type="button"
        onClick={onAddOption}
        style={{
          alignSelf: "flex-start",
          padding: "4px 10px",
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 1.5,
          color: C.cacao,
          background: "transparent",
          border: `1px dashed ${C.sand}`,
          borderRadius: 999,
          cursor: "pointer",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        + Opción
      </button>

      {error && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.terracotta,
            letterSpacing: 0.5,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function OptionEditor({
  option,
  eligible,
  usedComponentIds,
  onChange,
  onRemove,
  canRemove,
}: {
  option: OptionState;
  eligible: Product[];
  usedComponentIds: Set<number>;
  onChange: (patch: Partial<OptionState>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = Number(e.target.value);
    onChange({ component_id: Number.isFinite(val) && val > 0 ? val : null });
  };

  // Layout en 2 filas para no desbordar el panel lateral (angosto):
  // fila 1 → select del componente, full-width. Fila 2 → label "Default",
  // stepper compacto +/− con número editable, y botón eliminar al extremo.
  // El stepper reemplaza el <input type="number">: en móvil el spinner
  // nativo invade el ancho y empuja el resto del row.
  const dec = () =>
    onChange({
      default_quantity: Math.max(0, option.default_quantity - 1),
    });
  const inc = () =>
    onChange({ default_quantity: option.default_quantity + 1 });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        border: `1px solid ${C.sand}`,
        borderRadius: 8,
        background: C.paper,
        minWidth: 0,
      }}
    >
      <select
        value={option.component_id ?? ""}
        onChange={onSelect}
        style={{
          ...inputBase,
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          appearance: "none",
          backgroundImage:
            "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
          backgroundPosition:
            "calc(100% - 14px) center, calc(100% - 8px) center",
          backgroundSize: "6px 6px",
          backgroundRepeat: "no-repeat",
          paddingRight: 24,
          textOverflow: "ellipsis",
        }}
      >
        <option value="">— Elegí componente —</option>
        {eligible.map((p) => {
          const isUsed = usedComponentIds.has(p.id);
          return (
            <option key={p.id} value={p.id} disabled={isUsed}>
              {p.name} · stock {p.stock}
              {isUsed ? " (ya elegido)" : ""}
            </option>
          );
        })}
      </select>
      {option.component_id !== null && (
        <ComponentStockHint
          componentId={option.component_id}
          eligible={eligible}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 1.2,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
            flex: 1,
          }}
        >
          Default
        </span>
        <button
          type="button"
          onClick={dec}
          aria-label="Reducir default"
          disabled={option.default_quantity <= 0}
          style={stepperBtn(option.default_quantity <= 0)}
        >
          −
        </button>
        <input
          type="number"
          min={0}
          step={1}
          value={option.default_quantity}
          onChange={(e) =>
            onChange({
              default_quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
          style={{
            ...inputBase,
            width: 48,
            textAlign: "center",
            padding: "6px 4px",
            MozAppearance: "textfield",
          }}
          aria-label="Cantidad por defecto"
        />
        <button
          type="button"
          onClick={inc}
          aria-label="Aumentar default"
          style={stepperBtn(false)}
        >
          +
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Eliminar opción"
          title={canRemove ? "Eliminar opción" : "Al menos una opción requerida"}
          style={{
            width: 26,
            height: 26,
            marginLeft: 4,
            border: `1px solid ${C.sand}`,
            background: C.paper,
            color: canRemove ? C.mute : C.sand,
            borderRadius: 999,
            cursor: canRemove ? "pointer" : "not-allowed",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function stepperBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: `1px solid ${disabled ? C.sand : C.cacao}`,
    background: disabled ? C.cream : C.paper,
    color: disabled ? C.mute : C.ink,
    fontFamily: FONT_DISPLAY,
    fontSize: 14,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function serverToState(slots: ProductRecipeSlotView[]): SlotState[] {
  return slots.map((s) => ({
    id: s.id,
    label: s.label,
    quantity: s.quantity,
    options: s.options.map((o) => ({
      id: o.id,
      component_id: o.component_id,
      default_quantity: o.default_quantity,
    })),
  }));
}

function validateSlots(slots: SlotState[]): (string | null)[] {
  return slots.map((slot) => {
    if (!slot.label.trim()) return "Etiqueta requerida";
    if (slot.quantity <= 0) return "Cantidad debe ser > 0";
    if (slot.options.length === 0) return "Al menos una opción";
    const seen = new Set<number>();
    for (const opt of slot.options) {
      if (opt.component_id == null) return "Falta elegir componente en una opción";
      if (seen.has(opt.component_id)) return "Componente repetido";
      seen.add(opt.component_id);
      if (opt.default_quantity < 0) return "Cantidad no puede ser negativa";
    }
    const sum = slot.options.reduce((acc, o) => acc + o.default_quantity, 0);
    if (sum !== slot.quantity)
      return `Suma de defaults (${sum}) debe igualar cantidad (${slot.quantity})`;
    return null;
  });
}

/**
 * Hint de stock del componente elegido en una opción. Ayuda al
 * operador a detectar en el acto que armó una receta sobre un
 * componente agotado (cuello de botella inmediato).
 */
function ComponentStockHint({
  componentId,
  eligible,
}: {
  componentId: number;
  eligible: Product[];
}) {
  const component = eligible.find((p) => p.id === componentId);
  if (!component) return null;
  const out = component.stock <= 0;
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 1,
        color: out ? C.terracotta : C.mute,
        textTransform: "uppercase",
        fontWeight: 700,
      }}
    >
      {out ? "⚠ Sin stock" : `Stock disponible: ${component.stock}`}
    </span>
  );
}

/**
 * Preview en vivo de cuántas unidades del compuesto se pueden armar
 * con el stock ACTUAL de los componentes elegidos. Mismo cálculo que
 * el backend (ProductAvailabilityService): por slot,
 * floor(suma_stock_opciones / quantity); el producto queda limitado
 * por el slot más escaso. Regla estricta: si alguna opción no tiene
 * stock, el gating del cliente bloquea el producto (0 armables
 * visibles) — lo reflejamos con el mismo criterio para que el número
 * del editor coincida con la grilla.
 */
function DerivedStockPreview({
  slots,
  allProducts,
}: {
  slots: SlotState[];
  allProducts: Product[];
}) {
  const stockById = new Map(allProducts.map((p) => [p.id, p.stock]));

  let minUnits = Number.POSITIVE_INFINITY;
  let blocked = false;
  let incomplete = false;

  for (const slot of slots) {
    if (slot.quantity <= 0 || slot.options.length === 0) {
      incomplete = true;
      continue;
    }
    let total = 0;
    for (const opt of slot.options) {
      if (opt.component_id == null) {
        incomplete = true;
        continue;
      }
      const stock = stockById.get(opt.component_id) ?? 0;
      if (stock <= 0) blocked = true;
      total += stock;
    }
    minUnits = Math.min(minUnits, Math.floor(total / slot.quantity));
  }
  if (!Number.isFinite(minUnits)) minUnits = 0;
  const units = blocked ? 0 : minUnits;

  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        background: blocked ? C.terracottaSoft : C.oliveSoft,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 1,
        color: C.ink,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 8,
      }}
    >
      <span style={{ textTransform: "uppercase", fontWeight: 700 }}>
        Armables con stock actual
      </span>
      <strong style={{ fontFamily: FONT_DISPLAY, fontSize: 16 }}>
        {incomplete ? "—" : units}
        {blocked && !incomplete && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              marginLeft: 6,
              color: C.terracotta,
            }}
          >
            (bloqueado: opción sin stock)
          </span>
        )}
      </strong>
    </div>
  );
}
