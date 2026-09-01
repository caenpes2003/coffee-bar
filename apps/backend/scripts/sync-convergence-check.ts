/**
 * Test de convergencia entre nodos (Fase 2 de sync).
 *
 * Dos bases pueden tener el MISMO conteo y datos DISTINTOS — este
 * script compara campo a campo, por external_id, los aggregates que
 * sincronizan, entre el nodo emisor (SOURCE) y el receptor (TARGET).
 *
 * Uso:
 *   SOURCE_URL=postgresql://...local  TARGET_URL=postgresql://...cloud \
 *     npx tsx scripts/sync-convergence-check.ts
 *
 * Reporta por aggregate: faltantes en target, sobrantes solo-en-target
 * (informativo — el target puede tener entidades propias) y mismatches
 * de campos críticos (con ejemplos).
 *
 * Stock (§5.5): NO se compara Product.stock (divergencia esperada).
 * Se compara el LEDGER replicable: SUM(InventoryMovement.quantity)
 * por producto. La derivación completa del stock exige además los
 * descuentos por venta (OrderItem/OrderItemComponent), que aún no se
 * replican — cuando Orders entren al sync, este check se extiende al
 * replay completo.
 */

import { PrismaClient } from "@prisma/client";

const sourceUrl = process.env.SOURCE_URL;
const targetUrl = process.env.TARGET_URL;
if (!sourceUrl || !targetUrl) {
  console.error("Faltan SOURCE_URL y/o TARGET_URL");
  process.exit(1);
}

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

type Row = Record<string, unknown> & { external_id: string };

/** Normaliza valores para comparar (Decimal→number, Date→ISO). */
function norm(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return Number(v);
  }
  return v;
}

function diffRows(
  a: Row,
  b: Row,
  fields: string[],
): string[] {
  const diffs: string[] = [];
  for (const f of fields) {
    const va = norm(a[f]);
    const vb = norm(b[f]);
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      diffs.push(`${f}: source=${JSON.stringify(va)} target=${JSON.stringify(vb)}`);
    }
  }
  return diffs;
}

async function compare(
  label: string,
  fields: string[],
  fetch: (client: PrismaClient) => Promise<Row[]>,
): Promise<boolean> {
  const [srcRows, tgtRows] = await Promise.all([fetch(source), fetch(target)]);
  const tgtByExternal = new Map(tgtRows.map((r) => [r.external_id, r]));
  let missing = 0;
  let mismatched = 0;
  const examples: string[] = [];
  for (const src of srcRows) {
    const tgt = tgtByExternal.get(src.external_id);
    if (!tgt) {
      missing += 1;
      if (examples.length < 3) examples.push(`FALTA ${src.external_id}`);
      continue;
    }
    const diffs = diffRows(src, tgt, fields);
    if (diffs.length > 0) {
      mismatched += 1;
      if (examples.length < 3) {
        examples.push(`≠ ${src.external_id}: ${diffs.join("; ")}`);
      }
    }
  }
  const onlyTarget = tgtRows.length - (srcRows.length - missing);
  const ok = missing === 0 && mismatched === 0;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: source=${srcRows.length} target=${tgtRows.length} | faltantes=${missing} mismatches=${mismatched} solo-target=${onlyTarget}`,
  );
  for (const e of examples) console.log(`    ${e}`);
  return ok;
}

async function main() {
  console.log("=== Convergencia de sync (source → target) ===\n");
  let allOk = true;
  const check = async (
    label: string,
    fields: string[],
    fetch: (c: PrismaClient) => Promise<Row[]>,
  ) => {
    allOk = (await compare(label, fields, fetch)) && allOk;
  };

  await check(
    "TableSession",
    ["table_id", "status", "total_consumption", "paid_at", "closed_at", "voided_at", "custom_name", "opened_by"],
    (c) => c.tableSession.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "Consumption",
    ["type", "description", "quantity", "unit_amount", "amount", "reversed_at", "reason", "created_by"],
    (c) => c.consumption.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "Payment",
    ["method", "kind", "amount", "reference", "created_by"],
    (c) => c.payment.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "CashRegisterSession",
    ["status", "opening_balance", "closing_balance_declared", "closing_balance_expected", "difference", "opened_by", "closed_by"],
    (c) => c.cashRegisterSession.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "Expense",
    ["method", "category", "kind", "amount", "concept", "created_by"],
    (c) => c.expense.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "ExtraIncome",
    ["type", "subtype", "method", "total_amount", "status", "concept"],
    (c) => c.extraIncome.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "LuggageTicket",
    ["ticket_number", "amount", "payment_status", "method", "status"],
    (c) => c.luggageTicket.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "InventoryMovement",
    ["product_id", "type", "quantity", "reason"],
    (c) => c.inventoryMovement.findMany() as unknown as Promise<Row[]>,
  );
  await check(
    "PartialPaymentAllocation",
    ["quantity", "amount"],
    (c) => c.partialPaymentAllocation.findMany() as unknown as Promise<Row[]>,
  );

  // Ledger de inventario agregado por producto (lo replicable del §5.5).
  const [srcLedger, tgtLedger] = await Promise.all(
    [source, target].map((c) =>
      c.inventoryMovement.groupBy({
        by: ["product_id"],
        _sum: { quantity: true },
      }),
    ),
  );
  const tgtByProduct = new Map(
    tgtLedger.map((r) => [r.product_id, r._sum.quantity ?? 0]),
  );
  let ledgerDiffs = 0;
  for (const r of srcLedger) {
    const tgtSum = tgtByProduct.get(r.product_id) ?? 0;
    if ((r._sum.quantity ?? 0) !== tgtSum) {
      ledgerDiffs += 1;
      if (ledgerDiffs <= 3) {
        console.log(
          `    ledger producto ${r.product_id}: source=${r._sum.quantity} target=${tgtSum}`,
        );
      }
    }
  }
  console.log(
    `${ledgerDiffs === 0 ? "✓" : "✗"} Ledger de inventario (SUM por producto): ${ledgerDiffs} divergencia(s)`,
  );
  allOk = ledgerDiffs === 0 && allOk;

  console.log(
    `\n=== ${allOk ? "CONVERGENTE ✓" : "DIVERGENTE ✗ — revisar arriba"} ===`,
  );
  process.exit(allOk ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  });
