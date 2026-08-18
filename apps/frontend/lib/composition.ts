import type { BillLineUnit } from "@coffee-bar/shared";
import type { ProductRecipeSlotView } from "@/lib/api/services";

/** Shape del payload `units` que espera orderRequestsApi.quickAdd. */
export type QuickAddUnit = {
  composition: Array<{
    slot_id: number;
    options: Array<{ option_id: number; quantity: number }>;
  }>;
};

/**
 * Reconstruye el payload `units` de quickAdd desde la composición REAL
 * de una línea ya vendida (BillLineUnit, que trae component product_id)
 * y la receta ACTUAL del producto. Es el corazón del botón "+" de
 * repetir línea: pedir "uno igual" sin re-armar el cubetazo a mano.
 *
 * Greedy por slot en orden de posición: cada componente de la unidad
 * se asigna a la primera opción de slot que lo acepte, hasta llenar
 * slot.quantity. Devuelve null si la receta cambió desde la venta y la
 * composición vieja ya no encaja (componente sin opción, slot que no
 * se llena, o sobran componentes) — el caller cae al picker manual.
 */
export function buildUnitsFromComposition(
  slots: ProductRecipeSlotView[],
  units: BillLineUnit[],
): QuickAddUnit[] | null {
  const result: QuickAddUnit[] = [];
  const orderedSlots = [...slots].sort((a, b) => a.position - b.position);
  for (const unit of units) {
    const remaining = new Map<number, number>();
    for (const comp of unit.components) {
      remaining.set(
        comp.product_id,
        (remaining.get(comp.product_id) ?? 0) + comp.quantity,
      );
    }
    const composition: QuickAddUnit["composition"] = [];
    for (const slot of orderedSlots) {
      let need = slot.quantity;
      const options: Array<{ option_id: number; quantity: number }> = [];
      for (const opt of slot.options) {
        if (need === 0) break;
        const have = remaining.get(opt.component_id) ?? 0;
        if (have <= 0) continue;
        const take = Math.min(have, need);
        options.push({ option_id: opt.id, quantity: take });
        remaining.set(opt.component_id, have - take);
        need -= take;
      }
      if (need !== 0) return null;
      composition.push({ slot_id: slot.id, options });
    }
    for (const left of remaining.values()) {
      if (left > 0) return null;
    }
    result.push({ composition });
  }
  return result;
}

/**
 * Resumen agregado de la composición de una línea de la cuenta:
 * suma los componentes de todas las unidades y arma
 * "4× Águila Negra botella · 2× Poker lata".
 *
 * Se usa en la cuenta viva (AdminBillDrawer y CustomerBillModal) para
 * que un cubetazo armable muestre QUÉ salió, no solo el nombre.
 */
export function summarizeComposition(units: BillLineUnit[]): string {
  const totals = new Map<number, { name: string; quantity: number }>();
  for (const unit of units) {
    for (const comp of unit.components) {
      const prev = totals.get(comp.product_id);
      if (prev) prev.quantity += comp.quantity;
      else totals.set(comp.product_id, { name: comp.name, quantity: comp.quantity });
    }
  }
  return Array.from(totals.values())
    .map((t) => `${t.quantity}× ${t.name}`)
    .join(" · ");
}

/**
 * True si las unidades tienen composiciones distintas entre sí — en
 * ese caso la UI ofrece el detalle por unidad además del agregado
 * (dos cubetazos "iguales" pueden haberse armado diferente).
 */
export function compositionUnitsDiffer(units: BillLineUnit[]): boolean {
  if (units.length <= 1) return false;
  const keyOf = (u: BillLineUnit) =>
    u.components
      .map((c) => `${c.product_id}:${c.quantity}`)
      .sort()
      .join("|");
  const first = keyOf(units[0]);
  return units.some((u) => keyOf(u) !== first);
}

/** "3× Águila botella + 3× Poker lata" de UNA unidad (detalle plegable). */
export function describeUnit(unit: BillLineUnit): string {
  return unit.components.map((c) => `${c.quantity}× ${c.name}`).join(" + ");
}
