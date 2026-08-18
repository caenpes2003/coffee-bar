/**
 * Seed de cubetazos v2: un cubetazo POR MARCA con distribución
 * botella/lata elegible al vender (armable), reemplazando los
 * cubetazos fijos por presentación.
 *
 * Por qué: en la operación real un cubetazo mezcla botella y lata de
 * la misma marca (o de Águila+Poker en el mix) y el catálogo fijo
 * obligaba a registrar "el que más se pareciera" — inventario y
 * ventas no reflejaban lo servido.
 *
 * Idempotente: corre N veces y queda igual. No borra productos —
 * los cubetazos viejos se DESACTIVAN (is_active=false) para
 * conservar el histórico de ventas.
 *
 * Decisiones del dueño (2026-08):
 *   - Precio único por cubetazo sin importar la mezcla botella/lata.
 *     El precio se COPIA del cubetazo viejo equivalente (no se
 *     inventa acá).
 *   - Mix = solo Águila + Poker (botella/lata de ambas).
 *   - Águila Light solo existe en botella hoy → queda de una sola
 *     opción (fijo). Si algún día entra la lata al catálogo, se
 *     agrega la opción desde el editor de recetas del admin sin
 *     tocar código.
 *   - Defaults = todo botella (lo más vendido); el picker parte de
 *     ahí y el staff/cliente ajusta.
 *
 * Uso:
 *   npm run seed:buckets-v2 --workspace=@coffee-bar/backend
 *
 * En prod: correr DESPUÉS de deployar el commit (mismo criterio que
 * seed-recipes: revisar logs en una copia primero si hay dudas).
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Componentes por SKU (ya asignados por seed-recipes) ─────────────────
// Fallback por nombre exacto por si seed-recipes no corrió en este
// entorno. Mismos nombres que COMPONENT_SKUS de seed-recipes.ts.

const COMPONENT_FALLBACK_NAMES: Record<string, string> = {
  beer_aguila_negra_botella: "Aguila Negra botella 330 ml",
  beer_aguila_lata: "Aguila lata 330 ml",
  beer_poker_botella: "Poker botella 330 ml",
  beer_poker_lata: "Poker lata 330",
  beer_aguila_light_botella: "Aguila ligth Botella 330 ml",
  beer_club_dorada_botella: "Club Dorada botella 330ml",
  beer_club_dorada_lata: "Club Dorada lata 330 ml",
};

// ─── Cubetazos v2 ─────────────────────────────────────────────────────────
// price_from: SKU del cubetazo viejo del que se copia el precio.
// Los defaults de cada slot deben sumar slot.quantity (los aplica
// resolveCompositionPlan cuando el pedido no especifica composición).

type BucketV2 = {
  sku: string;
  name: string;
  category: string;
  price_from: string;
  fallback_price: number;
  slots: Array<{
    label: string;
    quantity: number;
    options: Array<[string, number]>; // [component_sku, default_qty]
  }>;
};

const BUCKETS_V2: BucketV2[] = [
  {
    sku: "bucket_v2_aguila",
    name: "Cubetazo Águila",
    category: "Cubetazo",
    price_from: "bucket_aguila_negra",
    fallback_price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 6],
          ["beer_aguila_lata", 0],
        ],
      },
    ],
  },
  {
    sku: "bucket_v2_poker",
    name: "Cubetazo Poker",
    category: "Cubetazo",
    price_from: "bucket_poker",
    fallback_price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_poker_botella", 6],
          ["beer_poker_lata", 0],
        ],
      },
    ],
  },
  {
    sku: "bucket_v2_aguila_light",
    name: "Cubetazo Águila Light",
    category: "Cubetazo",
    price_from: "bucket_aguila_light",
    fallback_price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        // Solo botella: no existe Águila Light lata en el catálogo.
        options: [["beer_aguila_light_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_v2_club_dorada",
    name: "Cubetazo Club Dorada",
    category: "Cubetazo",
    price_from: "bucket_club_dorada",
    fallback_price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_club_dorada_botella", 6],
          ["beer_club_dorada_lata", 0],
        ],
      },
    ],
  },
  {
    sku: "bucket_v2_mix",
    name: "Cubetazo Mix Águila + Poker",
    category: "Cubetazo",
    price_from: "bucket_aguila_poker_mix",
    fallback_price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_aguila_lata", 0],
          ["beer_poker_botella", 3],
          ["beer_poker_lata", 0],
        ],
      },
    ],
  },
];

// ─── Cubetazos viejos a desactivar (por SKU, nunca por nombre) ───────────
// Stella, Coronita, Club Trigo, sixpacks y combos quedan como están —
// no tienen reemplazo v2 definido.

const OLD_BUCKET_SKUS_TO_DEACTIVATE = [
  "bucket_aguila_negra",
  "bucket_poker",
  "bucket_aguila_light",
  "bucket_club_dorada",
  "bucket_aguila_poker_mix",
];

// ─── Helpers ──────────────────────────────────────────────────────────────

async function resolveComponentId(sku: string): Promise<number | null> {
  const bySku = await prisma.product.findUnique({ where: { sku } });
  if (bySku) return bySku.id;
  const fallbackName = COMPONENT_FALLBACK_NAMES[sku];
  if (!fallbackName) return null;
  const byName = await prisma.product.findFirst({
    where: { name: fallbackName },
  });
  if (!byName) {
    console.warn(`  ⚠ componente no encontrado: ${sku} ("${fallbackName}")`);
    return null;
  }
  return byName.id;
}

async function resolvePrice(item: BucketV2): Promise<Prisma.Decimal> {
  const old = await prisma.product.findUnique({
    where: { sku: item.price_from },
    select: { price: true },
  });
  if (old) return old.price;
  // Sin fila vieja: si el v2 ya existe conservamos su precio actual;
  // si no, caemos al fallback con warning para revisarlo a mano.
  const existing = await prisma.product.findUnique({
    where: { sku: item.sku },
    select: { price: true },
  });
  if (existing) return existing.price;
  console.warn(
    `  ⚠ ${item.sku}: no existe ${item.price_from} para copiar precio — usando fallback $${item.fallback_price}. REVISAR.`,
  );
  return new Prisma.Decimal(item.fallback_price);
}

async function upsertBucket(item: BucketV2, price: Prisma.Decimal): Promise<number> {
  const existing = await prisma.product.findUnique({
    where: { sku: item.sku },
  });
  if (existing) {
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        name: item.name,
        category: item.category,
        price,
        is_active: true,
      },
    });
    console.log(`  ✓ Existente actualizado: ${item.sku} ($${price.toString()})`);
    return existing.id;
  }
  const created = await prisma.product.create({
    data: {
      sku: item.sku,
      name: item.name,
      category: item.category,
      price,
      // El stock propio de un compuesto no significa nada (se deriva
      // de los componentes) — 0 como los demás compuestos del seed.
      stock: 0,
      is_active: true,
    },
  });
  console.log(`  ✓ Creado: ${item.sku} (id=${created.id}, $${price.toString()})`);
  return created.id;
}

async function replaceRecipe(
  productId: number,
  item: BucketV2,
  componentIdBySku: Map<string, number>,
) {
  // Validar componentes y suma de defaults ANTES de tocar la BD.
  const missing: string[] = [];
  for (const slot of item.slots) {
    let defaultsSum = 0;
    for (const [sku, qty] of slot.options) {
      if (!componentIdBySku.has(sku)) missing.push(sku);
      defaultsSum += qty;
    }
    if (defaultsSum !== slot.quantity) {
      throw new Error(
        `${item.sku}: defaults del slot "${slot.label}" suman ${defaultsSum}, esperado ${slot.quantity}`,
      );
    }
  }
  if (missing.length > 0) {
    console.warn(
      `  ⚠ "${item.name}": faltan componentes (${[...new Set(missing)].join(", ")}). Skip receta.`,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.productRecipeSlot.deleteMany({ where: { product_id: productId } });
    for (const [slotIdx, slot] of item.slots.entries()) {
      await tx.productRecipeSlot.create({
        data: {
          product_id: productId,
          label: slot.label,
          quantity: slot.quantity,
          position: slotIdx,
          options: {
            create: slot.options.map(([sku, qty], optIdx) => ({
              component_id: componentIdBySku.get(sku)!,
              default_quantity: qty,
              position: optIdx,
            })),
          },
        },
      });
    }
  });
  console.log(`  ✓ Receta cargada: "${item.name}"`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seed cubetazos v2 ===\n");

  // 1) Resolver componentes.
  console.log("Paso 1: componentes...");
  const componentIdBySku = new Map<string, number>();
  const allComponentSkus = new Set(
    BUCKETS_V2.flatMap((b) => b.slots.flatMap((s) => s.options.map(([sku]) => sku))),
  );
  for (const sku of allComponentSkus) {
    const id = await resolveComponentId(sku);
    if (id != null) componentIdBySku.set(sku, id);
  }
  console.log(
    `  Componentes mapeados: ${componentIdBySku.size}/${allComponentSkus.size}\n`,
  );

  // 2) Crear/actualizar cubetazos v2 + recetas (precio copiado del viejo).
  console.log("Paso 2: cubetazos v2...");
  for (const item of BUCKETS_V2) {
    const price = await resolvePrice(item);
    const id = await upsertBucket(item, price);
    await replaceRecipe(id, item, componentIdBySku);
  }
  console.log("");

  // 3) Desactivar los viejos SOLO después de que los v2 existan.
  console.log("Paso 3: desactivar cubetazos viejos...");
  for (const sku of OLD_BUCKET_SKUS_TO_DEACTIVATE) {
    const result = await prisma.product.updateMany({
      where: { sku, is_active: true },
      data: { is_active: false },
    });
    console.log(
      result.count > 0
        ? `  ✓ ${sku} desactivado`
        : `  · ${sku} ya estaba inactivo (o no existe)`,
    );
  }

  console.log("\n=== Seed cubetazos v2 completado ===");
  console.log(
    "Sin reemplazo (quedan igual): stella, coronita, club trigo, sixpacks y combos con licor.",
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
