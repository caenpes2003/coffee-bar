import type { BillLineUnit } from "@coffee-bar/shared";

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
