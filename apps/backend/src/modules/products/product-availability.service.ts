import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

/**
 * Disponibilidad de un producto compuesto:
 *   - `status`: gating binario que ve el cliente.
 *   - `derived_stock`: cuántas unidades completas del compuesto se
 *     pueden armar con el stock actual de componentes (bottleneck
 *     entre slots). Es el número que el admin ve en la grilla en
 *     lugar del `Product.stock` legacy (que para compuestos suele
 *     estar fijo en 999 y no significa nada).
 */
export type CompositeAvailability = {
  status: "available" | "out_of_stock";
  derived_stock: number;
};

/**
 * Calcula disponibilidad de productos compuestos.
 *
 * Regla ESTRICTA de gating (decisión operativa del bar — NO relajar
 * sin decisión explícita):
 *   - Un compuesto está "available" sí y sólo sí TODAS las opciones de
 *     TODOS sus slots tienen al menos 1 unidad de stock (Y además stock
 *     suficiente para cubrir cualquier reparto que el cliente intente).
 *   - Si CUALQUIER componente listado en una opción tiene stock 0, el
 *     producto compuesto queda "out_of_stock" — aunque otras opciones
 *     del mismo slot tengan stock suficiente.
 *
 * Razón: el cliente espera consistencia. Un cubetazo "mix aguila/poker"
 * con 0 poker está físicamente vendible (6 aguila), pero la promesa
 * del producto es "puede haber poker". Si bloqueamos al mostrar el
 * producto, el cliente no pasa por la frustración de elegir 4+2 y que
 * el server rechace al aceptar. Tradeoff: vendemos menos cuando un
 * componente está agotado. Aceptable.
 *
 * `derived_stock` es CONSISTENTE con el gating: si el producto está
 * bloqueado por la regla estricta, derived_stock = 0 (no mostramos
 * "7 armables" junto a un badge de agotado — sería contradictorio).
 * Cuando está disponible, derived_stock = min entre slots de
 * floor(suma_stock_opciones / slot.quantity).
 *
 * Limitación conocida: si un mismo componente aparece en DOS slots del
 * mismo producto, este cálculo cuenta su stock dos veces (el máximo
 * real sería menor). Ninguna receta actual del bar tiene esa forma;
 * si aparece, el cálculo exacto es un problema de flujo — resolver
 * entonces, no ahora.
 *
 * Performance: una sola query a Prisma trae slots + opciones + stock
 * de cada componente; el resto es agregación en memoria. Costo O(n)
 * en el número de slots/opciones por producto, OK para los 30 que
 * tenemos.
 */
@Injectable()
export class ProductAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mapa `product_id → CompositeAvailability` para los productos cuyo
   * id está en `productIds` Y son compuestos. Los productos no
   * compuestos no aparecen en el mapa (el llamador cae al check
   * `stock > 0` que ya hace).
   */
  async computeForProducts(
    productIds: number[],
  ): Promise<Map<number, CompositeAvailability>> {
    if (productIds.length === 0) return new Map();

    const slots = await this.prisma.productRecipeSlot.findMany({
      where: { product_id: { in: productIds } },
      include: {
        options: {
          include: {
            component: { select: { id: true, stock: true, is_active: true } },
          },
        },
      },
    });

    // Group slots by product.
    const slotsByProduct = new Map<number, typeof slots>();
    for (const slot of slots) {
      const list = slotsByProduct.get(slot.product_id) ?? [];
      list.push(slot);
      slotsByProduct.set(slot.product_id, list);
    }

    const result = new Map<number, CompositeAvailability>();
    for (const [productId, productSlots] of slotsByProduct) {
      // Regla estricta: cada componente listado debe tener stock > 0.
      // Si CUALQUIER opción de CUALQUIER slot tiene stock 0, el
      // compuesto queda agotado. Y además la suma de stocks por slot
      // debe cubrir slot.quantity (chequeo redundante pero explícito).
      let allOk = true;
      // Unidades armables limitadas por el slot más escaso (bottleneck).
      let minUnits = Number.POSITIVE_INFINITY;

      for (const slot of productSlots) {
        const everyOptionHasStock = slot.options.every(
          (opt) => (opt.component?.stock ?? 0) > 0,
        );
        const totalAvailable = slot.options.reduce(
          (acc, opt) => acc + (opt.component?.stock ?? 0),
          0,
        );
        if (!everyOptionHasStock || totalAvailable < slot.quantity) {
          allOk = false;
        }
        // floor(suma / cantidad_por_unidad). quantity siempre >= 1
        // (validado al guardar la receta), pero el guard evita un
        // division-by-zero si un dato viejo quedó en 0.
        const unitsForSlot =
          slot.quantity > 0
            ? Math.floor(totalAvailable / slot.quantity)
            : 0;
        minUnits = Math.min(minUnits, unitsForSlot);
      }

      // Sin slots (no debería pasar: el mapa solo tiene compuestos),
      // o receta corrupta → 0.
      if (!Number.isFinite(minUnits)) minUnits = 0;

      result.set(productId, {
        status: allOk ? "available" : "out_of_stock",
        // Consistente con el gating: bloqueado ⇒ 0 armables visibles.
        derived_stock: allOk ? minUnits : 0,
      });
    }
    return result;
  }
}
