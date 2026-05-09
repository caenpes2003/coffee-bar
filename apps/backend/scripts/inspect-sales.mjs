// Diagnóstico temporal de Consumption + ventas.
// Uso: node apps/backend/scripts/inspect-sales.mjs
//
// Imprime:
//   1) Resumen de los últimos 7 días: consumptions por tipo y por día.
//   2) Sesiones recientes con sus parciales y status de pago.
//   3) Caso específico: una sesión cerrada hoy con parciales.
//
// Borrar este archivo cuando terminemos el diagnóstico.

import "dotenv/config";
import { PrismaClient, ConsumptionType } from "@prisma/client";

const prisma = new PrismaClient();

function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmt(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function money(n) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

async function main() {
  const today = startOfDayLocal(new Date());
  const sevenAgo = new Date(today);
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`\n=== Rango: ${fmt(sevenAgo)} → ${fmt(tomorrow)} ===\n`);

  // ─── 1. Conteo de consumptions por tipo en los últimos 7 días ──────────
  const all = await prisma.consumption.findMany({
    where: { created_at: { gte: sevenAgo, lt: tomorrow } },
    select: {
      id: true,
      type: true,
      amount: true,
      quantity: true,
      created_at: true,
      reversed_at: true,
      table_session_id: true,
      product_id: true,
      description: true,
    },
    orderBy: { created_at: "asc" },
  });

  console.log(`Total consumptions últimos 7 días: ${all.length}\n`);

  const byType = new Map();
  for (const c of all) {
    if (c.reversed_at) continue;
    const k = c.type;
    const slot = byType.get(k) ?? { count: 0, sum: 0 };
    slot.count++;
    slot.sum += Number(c.amount);
    byType.set(k, slot);
  }
  console.log("Por tipo (excluye reversed):");
  for (const [t, v] of byType) {
    console.log(`  ${t.padEnd(20)} count=${String(v.count).padStart(4)}  total=${money(v.sum)}`);
  }

  // ─── 2. Por día (solo type=product, mismo filtro que sales-insights) ──
  console.log("\nProduct revenue por día (lo que ve el dashboard):");
  const dailyMap = new Map();
  for (const c of all) {
    if (c.type !== ConsumptionType.product) continue;
    if (c.reversed_at) continue;
    const k = `${c.created_at.getFullYear()}-${String(c.created_at.getMonth() + 1).padStart(2, "0")}-${String(c.created_at.getDate()).padStart(2, "0")}`;
    const slot = dailyMap.get(k) ?? { units: 0, revenue: 0 };
    slot.units += c.quantity;
    slot.revenue += Number(c.amount);
    dailyMap.set(k, slot);
  }
  for (const [day, v] of [...dailyMap.entries()].sort()) {
    console.log(`  ${day}  units=${String(v.units).padStart(4)}  revenue=${money(v.revenue)}`);
  }

  // ─── 3. Sesiones recientes con detalle ────────────────────────────────
  const sessions = await prisma.tableSession.findMany({
    where: { opened_at: { gte: sevenAgo } },
    select: {
      id: true,
      table_id: true,
      opened_at: true,
      closed_at: true,
      paid_at: true,
      total_consumption: true,
      consumptions: {
        select: {
          id: true,
          type: true,
          amount: true,
          created_at: true,
          reversed_at: true,
          description: true,
        },
        orderBy: { created_at: "asc" },
      },
    },
    orderBy: { opened_at: "desc" },
    take: 20,
  });

  console.log(`\n=== Sesiones recientes (últimas ${sessions.length}) ===`);
  for (const s of sessions) {
    const partials = s.consumptions.filter(
      (c) => c.type === "partial_payment" && !c.reversed_at,
    );
    const products = s.consumptions.filter(
      (c) => c.type === "product" && !c.reversed_at,
    );
    const productSum = products.reduce((a, c) => a + Number(c.amount), 0);
    const partialSum = partials.reduce((a, c) => a + Number(c.amount), 0); // ya viene negativo

    console.log(
      `\n  Mesa ${s.table_id} · sesión ${s.id}` +
        `\n    Abierta: ${fmt(s.opened_at)}` +
        `\n    Cerrada: ${s.closed_at ? fmt(s.closed_at) : "(abierta)"}` +
        `\n    Pagada:  ${s.paid_at ? fmt(s.paid_at) : "(no)"}` +
        `\n    total_consumption (campo BD): ${money(s.total_consumption)}` +
        `\n    Σ products ledger:            ${money(productSum)}` +
        `\n    Σ partial_payments ledger:    ${money(partialSum)}  (negativo = se cobró)` +
        `\n    Pendiente lógico:             ${money(productSum + partialSum)}`,
    );

    if (partials.length > 0) {
      console.log(`    Parciales detalle:`);
      for (const p of partials) {
        console.log(
          `      ${fmt(p.created_at)}  ${money(p.amount)}  "${p.description ?? ""}"`,
        );
      }
    }
    if (products.length > 0) {
      const firstP = products[0].created_at;
      const lastP = products[products.length - 1].created_at;
      console.log(
        `    Products: ${products.length} rows, desde ${fmt(firstP)} hasta ${fmt(lastP)}`,
      );
    }
  }

  console.log("\n=== Done ===\n");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
