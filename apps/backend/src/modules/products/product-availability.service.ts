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
 * Cada slot debe tener stock suficiente entre sus opciones para completar
 * slot.quantity. Una opcion agotada no bloquea las otras alternativas:
 * un cubetazo de 6 sigue disponible si las cervezas restantes suman 6.
 * Los slots de una sola opcion siguen exigiendo todo su ingrediente.
 *
 * derived_stock = minimo entre slots de
 * floor(suma_stock_opciones / slot.quantity). Solo esta disponible
 * cuando puede armarse al menos una unidad completa.
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
      // El slot con menos unidades completas limita el producto.
      let minUnits = Number.POSITIVE_INFINITY;

      for (const slot of productSlots) {
        const totalAvailable = slot.options.reduce(
          (acc, opt) => acc + Math.max(0, opt.component?.stock ?? 0),
          0,
        );
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
        status: minUnits > 0 ? "available" : "out_of_stock",
        derived_stock: minUnits,
      });
    }
    return result;
  }
}
