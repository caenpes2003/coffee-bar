/**
 * Limpieza de catálogo 2026-08 (pedido del dueño):
 *
 *   1. Renombres: "ligth" → "LIGHT" (botella y lata), "Medio de
 *      Amarillo" → "MEDIA DE AMARILLO".
 *   2. Eliminación de productos: MORE duplicado (categoría
 *      "Cigarillos" de un solo producto), 3 cubetazos manuales de
 *      lata/mixtos que el Cubetazo v2 volvió redundantes, DE TODITO
 *      PAQUETON duplicado (categoría "GALGUERIA" de un solo
 *      producto) y BON FIEST PLUS (categoría "Medicamentos").
 *      Regla: si el producto tiene historial (ventas o uso como
 *      componente), la BD prohíbe borrarlo → se DESACTIVA, que lo
 *      saca de menú/catálogo/operación igual. Sin historial → borrado
 *      físico (cascade se lleva receta y movimientos de inventario).
 *      Las "categorías eliminadas" desaparecen solas: una categoría
 *      es el texto de sus productos.
 *   3. AGUILA LIGHT LATA (existe hace poco) entra como opción del
 *      Cubetazo Águila Light — era el plan original del cubetazo por
 *      marca, pendiente porque la lata no existía en el catálogo.
 *   4. Barrido final: TODOS los nombres y categorías a MAYÚSCULAS
 *      (el service ya normaliza los nuevos; esto migra lo histórico).
 *      De paso unifica GALGUERIA/Galgueria y LICOR/Licor.
 *
 * Idempotente: corre N veces y queda igual.
 *
 * Uso: npm run cleanup:catalog --workspace=@coffee-bar/backend
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Renombres (por SKU; el nombre final ya va en mayúsculas) ────────────
const RENAMES: Array<{ sku: string; to: string }> = [
  { sku: "beer_aguila_light_botella", to: "AGUILA LIGHT BOTELLA 330ML" },
  { sku: "aguila_ligth_lata_330_ml_mq4fbvex", to: "AGUILA LIGHT LATA 330ML" },
  { sku: "liquor_amarillo_media", to: "MEDIA DE AMARILLO" },
];

// ─── Productos a eliminar (borrado físico o desactivación) ───────────────
const REMOVALS: Array<{ sku: string; label: string }> = [
  { sku: "more_mtf7rj1w", label: "MORE (categoría Cigarillos duplicada)" },
  { sku: "bon_fiest_plus_mqbs6xlv", label: "BON FIEST PLUS (Medicamentos)" },
];

// ─── Borrado FORZADO (decisión explícita del dueño 2026-08-31) ───────────
// Estos se eliminan AUNQUE tengan ventas: se borran también sus
// OrderItem históricos (con sus OrderItemComponent en cascada). Las
// facturas/cuentas viejas NO pierden la línea — el Consumption guarda
// nombre y monto en texto y no tiene FK al producto — pero el ticket
// de sesiones cerradas ya no podrá mostrar "ver composición" de esas
// ventas puntuales. Aceptado.
const FORCE_REMOVALS: Array<{ sku: string; label: string }> = [
  {
    sku: "cubetazo_aguila_lata_aguila_botella_msl0hoxe",
    label: "Cubetazo Aguila lata + Aguila Botella",
  },
  {
    sku: "cubetazo_mix_aguila_lata_poker_botella_mscgs8th",
    label: "Cubetazo mix Aguila Lata + Poker Botella",
  },
  {
    sku: "cubetazo_mix_en_lata_poker_aguila_msce4f9l",
    label: "CUBETAZO MIX EN LATA (POKER + AGUILA)",
  },
  {
    sku: "de_todito_paqueton_165_gr_mszg0mba",
    label: "DE TODITO PAQUETON (categoría GALGUERIA duplicada)",
  },
];

async function forceRemoveProduct(sku: string, label: string) {
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) {
    console.log(`  · ${label}: no existe (¿ya eliminado?)`);
    return;
  }
  // Sí protegemos UNA cosa: si el producto es COMPONENTE en recetas de
  // otros productos vivos, borrarlo rompería esos armables — eso no es
  // "historial", es catálogo activo. Ninguno de los targets lo es.
  const inRecipes = await prisma.productRecipeOption.count({
    where: { component_id: product.id },
  });
  if (inRecipes > 0) {
    console.log(
      `  ⚠ ${label}: es componente de ${inRecipes} receta(s) activa(s) — NO se fuerza. Revisar a mano.`,
    );
    return;
  }
  await prisma.$transaction(async (tx) => {
    // OrderItemComponent cae en cascada al borrar los OrderItem.
    const items = await tx.orderItem.deleteMany({
      where: { product_id: product.id },
    });
    // El delete del producto se lleva en cascada su receta propia y
    // sus movimientos de inventario.
    await tx.product.delete({ where: { id: product.id } });
    console.log(
      `  ✓ ${label}: ELIMINADO forzado (${items.count} línea(s) de pedido histórico borradas; los consumos de las facturas conservan nombre y monto)`,
    );
  });
}

async function removeProduct(sku: string, label: string) {
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) {
    console.log(`  · ${label}: no existe (¿ya eliminado?)`);
    return;
  }
  // Historial que la BD protege con Restrict: ventas (OrderItem),
  // uso como componente físico (OrderItemComponent) y presencia en
  // recetas de OTROS productos (ProductRecipeOption).
  const [sold, asComponent, inRecipes] = await Promise.all([
    prisma.orderItem.count({ where: { product_id: product.id } }),
    prisma.orderItemComponent.count({
      where: { component_product_id: product.id },
    }),
    prisma.productRecipeOption.count({
      where: { component_id: product.id },
    }),
  ]);
  if (sold === 0 && asComponent === 0 && inRecipes === 0) {
    await prisma.product.delete({ where: { id: product.id } });
    console.log(`  ✓ ${label}: ELIMINADO físicamente (sin historial)`);
    return;
  }
  if (product.is_active) {
    await prisma.product.update({
      where: { id: product.id },
      data: { is_active: false },
    });
    console.log(
      `  ✓ ${label}: con historial (${sold} ventas, ${asComponent} como componente, ${inRecipes} en recetas) → DESACTIVADO`,
    );
  } else {
    console.log(`  · ${label}: con historial, ya estaba desactivado`);
  }
}

async function main() {
  console.log("=== Limpieza de catálogo 2026-08 ===\n");

  // 1) Renombres.
  console.log("Paso 1: renombres...");
  for (const r of RENAMES) {
    const product = await prisma.product.findUnique({ where: { sku: r.sku } });
    if (!product) {
      console.log(`  ⚠ sku ${r.sku} no encontrado. Skip.`);
      continue;
    }
    if (product.name === r.to) {
      console.log(`  · "${r.to}" ya está`);
      continue;
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { name: r.to },
    });
    console.log(`  ✓ "${product.name}" → "${r.to}"`);
  }

  // 2) Eliminaciones.
  console.log("\nPaso 2: eliminar productos...");
  for (const r of REMOVALS) {
    await removeProduct(r.sku, r.label);
  }
  console.log("\nPaso 2b: eliminaciones FORZADAS (con historial)...");
  for (const r of FORCE_REMOVALS) {
    await forceRemoveProduct(r.sku, r.label);
  }

  // 3) AGUILA LIGHT LATA como opción del Cubetazo Águila Light.
  console.log("\nPaso 3: lata al Cubetazo Águila Light...");
  const bucket = await prisma.product.findUnique({
    where: { sku: "bucket_v2_aguila_light" },
    include: { recipe_slots: { include: { options: true } } },
  });
  const lightLata = await prisma.product.findUnique({
    where: { sku: "aguila_ligth_lata_330_ml_mq4fbvex" },
  });
  if (!bucket || bucket.recipe_slots.length === 0 || !lightLata) {
    console.log("  ⚠ falta el cubetazo v2 o la lata — skip");
  } else {
    const slot = bucket.recipe_slots[0];
    const already = slot.options.some(
      (o) => o.component_id === lightLata.id,
    );
    if (already) {
      console.log("  · la lata ya es opción del cubetazo");
    } else {
      await prisma.productRecipeOption.create({
        data: {
          slot_id: slot.id,
          component_id: lightLata.id,
          // Default 0: el armado por defecto sigue siendo 6 botellas;
          // la lata es elegible en el picker.
          default_quantity: 0,
          position: slot.options.length,
        },
      });
      console.log(
        `  ✓ "${lightLata.name}" agregada como opción (default 0)`,
      );
    }
  }

  // 4) Barrido a MAYÚSCULAS (nombres + categorías, colapsando
  //    espacios múltiples). Después de las eliminaciones, para que
  //    la fusión Galgueria→GALGUERIA no reviva duplicados.
  console.log("\nPaso 4: todo a mayúsculas...");
  // OJO: doble backslash — en un template literal de JS, '\s' pierde
  // la barra y el patrón le llegaría a Postgres como 's+' (reemplaza
  // las eses — pasó en dev: GASEOSA → "GA EO A").
  const changed = await prisma.$executeRaw`
    UPDATE "Product"
    SET name = UPPER(regexp_replace(trim(name), '\\s+', ' ', 'g')),
        category = UPPER(regexp_replace(trim(category), '\\s+', ' ', 'g'))
    WHERE name <> UPPER(regexp_replace(trim(name), '\\s+', ' ', 'g'))
       OR category <> UPPER(regexp_replace(trim(category), '\\s+', ' ', 'g'))
  `;
  console.log(`  ✓ ${changed} producto(s) actualizados`);

  // Resumen final de categorías.
  const categories = await prisma.product.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { category: "asc" },
  });
  console.log("\nCategorías resultantes:");
  for (const c of categories) {
    console.log(`  ${c.category} (${c._count._all})`);
  }

  console.log("\n=== Limpieza completada ===");
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
