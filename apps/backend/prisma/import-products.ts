/**
 * One-shot importer for the bar's product catalogue.
 *
 *   npm run db:import-products -- <path-to-xlsx-or-csv> [sheet-name]
 *
 * Sheet selection: if a workbook has multiple sheets, pass the sheet name
 * as the second argument. Defaults to "COSTO UNITARIO Y MARGEN POR PRO"
 * (the live catalogue's sheet name) and falls back to the first sheet if
 * that one isn't found.
 *
 * Reads expected columns by header name (case + accent insensitive):
 *
 *     Producto    →  Product.name        (string, required)
 *     Tipo        →  Product.category    (string, required)
 *     Precio Final → Product.price       (number, required)
 *
 * Anything else in the file is ignored (Costo Compra, Margen, etc. are
 * accounting columns the app doesn't model). Rows with empty Producto are
 * skipped silently — useful when the source spreadsheet has section
 * dividers or trailing blank lines.
 *
 * Behavior:
 *   - Idempotent on `name`: if a Product with the same name exists, its
 *     price/category are UPDATED. New names are inserted with a default
 *     stock of 0 (you set real stock from /admin/products afterwards).
 *   - Logs a summary: created vs. updated vs. skipped.
 *   - Wrapped in a single transaction so a malformed row aborts the whole
 *     import without leaving half a catalogue in place.
 *
 * Run against production by setting DATABASE_URL to the prod connection
 * string in your shell before invoking the script. Stuff like
 *   DATABASE_URL="postgresql://..." npm run db:import-products -- ./catalogo.xlsx
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

interface RawRow {
  [key: string]: unknown;
}

interface ParsedRow {
  name: string;
  category: string;
  price: number;
}

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.round(raw);
  // Excel cells often arrive as strings like "$5,317" or "$ 5.317" depending
  // on the locale. Strip everything that isn't a digit before parsing.
  const cleaned = String(raw).replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pick(row: RawRow, ...candidates: string[]): unknown {
  for (const key of Object.keys(row)) {
    const normalized = key
      .toString()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    if (candidates.some((c) => c === normalized)) {
      return row[key];
    }
  }
  return undefined;
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error(
      "[import-products] No file path provided. Usage: npm run db:import-products -- <path>",
    );
    process.exit(1);
  }
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`[import-products] File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`[import-products] Reading ${filePath}`);
  const workbook = XLSX.readFile(filePath);
  if (workbook.SheetNames.length === 0) {
    console.error("[import-products] Workbook has no sheets");
    process.exit(1);
  }

  // CLI override > live-catalogue default > first sheet fallback. We
  // resolve case-insensitively because the source workbook's sheet name
  // is in all-caps with spaces and a couple of special chars.
  const requestedSheet =
    process.argv[3] ?? "COSTO UNITARIO Y MARGEN POR PRO";
  const matchedName = workbook.SheetNames.find(
    (n) => n.trim().toLowerCase() === requestedSheet.trim().toLowerCase(),
  );
  const sheetName = matchedName ?? workbook.SheetNames[0];
  if (!matchedName) {
    console.warn(
      `[import-products] Sheet "${requestedSheet}" not found. Falling back to "${sheetName}". Available sheets: ${workbook.SheetNames.join(", ")}`,
    );
  }

  const sheet = workbook.Sheets[sheetName];

  // The live workbook is laid out with a precise rectangle:
  //   Headers:    row 4,  columns B..S
  //   Data rows:  rows 56..98, columns B..S
  // Above row 56 there are intermediate sections (cost analysis blocks,
  // section dividers) that share the same headers — importing those gives
  // false positives. Read the explicit ranges so the import stays stable
  // even if the spreadsheet author rearranges the upper section.
  const HEADER_RANGE = "B4:S4";
  const DATA_RANGE = "B56:S98";

  const headerMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    range: HEADER_RANGE,
  }) as unknown[][];
  const headerRow = headerMatrix[0] ?? [];
  const headers = headerRow.map((c) =>
    c == null ? "" : String(c).trim(),
  );
  if (!headers.length) {
    console.error(
      `[import-products] No header cells found at ${HEADER_RANGE}.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const dataMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    range: DATA_RANGE,
    blankrows: false,
  }) as unknown[][];

  const rows: RawRow[] = dataMatrix
    .map((row) => {
      const obj: RawRow = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        obj[key] = row[c] ?? null;
      }
      return obj;
    })
    .filter((r) => Object.values(r).some((v) => v != null && v !== ""));

  console.log(
    `[import-products] Sheet "${sheetName}" — header range ${HEADER_RANGE}, data range ${DATA_RANGE}: ${rows.length} non-empty rows`,
  );

  const parsed: ParsedRow[] = [];
  const skipped: { reason: string; row: RawRow }[] = [];

  for (const row of rows) {
    const name = pick(row, "producto", "nombre", "product", "name");
    const category = pick(row, "tipo", "categoria", "category");
    const price = pick(row, "precio final", "precio", "price", "precio venta");

    const nameStr = name == null ? "" : String(name).trim();
    const categoryStr = category == null ? "" : String(category).trim();
    const priceNum = parsePrice(price);

    if (!nameStr) {
      skipped.push({ reason: "missing name", row });
      continue;
    }
    if (!categoryStr) {
      skipped.push({ reason: "missing category", row });
      continue;
    }
    if (priceNum == null) {
      skipped.push({ reason: "missing/invalid price", row });
      continue;
    }
    parsed.push({ name: nameStr, category: categoryStr, price: priceNum });
  }

  console.log(
    `[import-products] Parsed ${parsed.length} valid rows, ${skipped.length} skipped`,
  );
  if (skipped.length > 0) {
    console.log("[import-products] Skipped sample:");
    for (const s of skipped.slice(0, 3)) {
      console.log(`  - ${s.reason}:`, s.row);
    }
  }

  if (parsed.length === 0) {
    console.error(
      "[import-products] Nothing to import. Check column names in the sheet.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  let created = 0;
  let updated = 0;

  // Generous timeout: when running against a remote Postgres (e.g. you
  // sitting in Colombia importing into Railway in US-West) each row does
  // two round trips and the default 5 s ceiling blows up halfway through
  // the catalogue. 60 s comfortably absorbs ~200 products even on a slow
  // residential link.
  await prisma.$transaction(
    async (tx) => {
      for (const row of parsed) {
        const existing = await tx.product.findFirst({
          where: { name: row.name },
          select: { id: true },
        });
        if (existing) {
          await tx.product.update({
            where: { id: existing.id },
            data: {
              category: row.category,
              price: row.price,
              is_active: true,
            },
          });
          updated += 1;
        } else {
          await tx.product.create({
            data: {
              name: row.name,
              category: row.category,
              price: row.price,
              stock: 0,
              is_active: true,
            },
          });
          created += 1;
        }
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log(
    `[import-products] Done. created=${created}, updated=${updated}, skipped=${skipped.length}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import-products] Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
