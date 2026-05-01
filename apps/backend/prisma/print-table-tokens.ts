/**
 * Reads existing tables from the DB and prints a table_token for each one,
 * without mutating any data. Use this when you've lost the seed output and
 * just want the QR tokens back.
 *
 *   npx tsx prisma/print-table-tokens.ts
 */
import { PrismaClient } from "@prisma/client";
import * as jwt from "jsonwebtoken";

const prisma = new PrismaClient();

async function main() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[print-table-tokens] JWT_SECRET is missing in .env");
    process.exit(1);
  }

  const tables = await prisma.table.findMany({ orderBy: { number: "asc" } });
  if (tables.length === 0) {
    console.error(
      "[print-table-tokens] No tables in DB. Run `npx tsx prisma/seed.ts` first.",
    );
    process.exit(1);
  }

  console.log("\n─── Table QR tokens ────────────────────────────────────");
  console.log("URL pattern: /mesa/:id?t=<token>\n");
  for (const t of tables) {
    const token = jwt.sign(
      { kind: "table", table_id: t.id },
      secret,
      { expiresIn: "365d" },
    );
    console.log(`mesa ${String(t.number).padStart(2, "0")} (id=${t.id}): ${token}`);
  }
  console.log("─────────────────────────────────────────────────────────\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
