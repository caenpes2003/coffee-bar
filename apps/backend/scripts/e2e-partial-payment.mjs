// E2E del flujo: pago parcial + cobrar y cerrar mesa.
// Verifica Modelo A: los ingresos cuentan al momento de la entrega,
// los parciales NO duplican ni alteran ingresos, el cierre tampoco
// agrega revenue.
//
// Uso:
//   node apps/backend/scripts/e2e-partial-payment.mjs
//
// Requiere:
//   - Backend corriendo en localhost:3001 (con TZ=America/Bogota).
//   - Admin seed disponible (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
//   - Al menos una mesa creada y un producto activo con stock > 0.
//
// Limpia: la sesión queda cerrada y pagada en BD, no se borra (es
// trazabilidad). Si querés rerun limpio, borrá la sesión de la tabla
// "table_sessions" antes de re-ejecutar.

import "dotenv/config";

const API = "http://localhost:3001/api";
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@cafe.local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

function ok(label, cond, extra = "") {
  const mark = cond ? "✓" : "✗";
  const c = cond ? "\x1b[32m" : "\x1b[31m";
  console.log(`  ${c}${mark}\x1b[0m ${label}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
}

async function call(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof data === "object" ? JSON.stringify(data) : text}`,
    );
  }
  return data;
}

async function main() {
  console.log("\n=== E2E pago parcial + cierre con balance ===\n");

  // 1. Login admin
  console.log("1) Login admin");
  const login = await call("POST", "/auth/login", {
    body: { email: adminEmail, password: adminPassword },
  });
  const token = login.token;
  ok("Token recibido", typeof token === "string" && token.length > 20);

  // 2. Tomar primer producto activo con stock
  console.log("\n2) Buscar producto de prueba");
  const products = await call("GET", "/admin/products", { token });
  const product = products.find((p) => p.is_active && p.stock >= 3);
  if (!product) {
    console.error(
      "  ✗ No hay producto activo con stock >= 3. Crea/repón uno y reintenta.",
    );
    process.exit(1);
  }
  console.log(
    `  Producto: ${product.name} (id=${product.id}) — precio ${product.price}, stock ${product.stock}`,
  );

  // 3. Tomar primera mesa libre. Si todas están ocupadas (típico al
  // re-ejecutar el script), cerramos+pagamos la primera para liberarla
  // — es seguro porque las sesiones que dejan estos tests siempre
  // tienen al menos una consumption, no quedan rows "fantasma".
  console.log("\n3) Buscar mesa libre");
  let tables = await call("GET", "/tables", { token });
  let table = tables.find((t) => t.current_session_id == null);
  if (!table) {
    const occupied = tables.find((t) => t.current_session_id != null);
    if (!occupied) {
      console.error("  ✗ No hay mesas configuradas en el sistema.");
      process.exit(1);
    }
    console.log(
      `  Todas las mesas ocupadas; liberando mesa ${occupied.id} (sesión ${occupied.current_session_id})…`,
    );
    await call(
      "POST",
      `/table-sessions/${occupied.current_session_id}/mark-paid`,
      { token },
    );
    tables = await call("GET", "/tables", { token });
    table = tables.find((t) => t.current_session_id == null);
    if (!table) {
      console.error("  ✗ No pude liberar ninguna mesa.");
      process.exit(1);
    }
  }
  console.log(`  Mesa: ${table.id} — número ${table.number ?? table.id}`);

  // 4. Abrir sesión (admin path)
  console.log("\n4) Abrir sesión en la mesa");
  const session = await call("POST", "/admin/table-sessions/open", {
    token,
    body: { table_id: table.id },
  });
  console.log(`  Sesión ${session.id} abierta`);

  // 5. Crear order request + accept en una sola llamada (admin quick-add)
  console.log("\n5) Crear pedido (3 unidades del producto)");
  const quickAdd = await call("POST", "/order-requests/admin/quick-add", {
    token,
    body: {
      table_session_id: session.id,
      items: [{ product_id: product.id, quantity: 3 }],
    },
  });
  const orderId = quickAdd.order?.id ?? quickAdd.order_id ?? quickAdd.id;
  ok(
    "OrderRequest creada + aceptada",
    orderId != null,
    `(order id=${orderId})`,
  );

  console.log("  Marcar order como delivered…");
  const delivered = await call("PATCH", `/orders/${orderId}/status`, {
    token,
    body: { status: "delivered" },
  });
  ok(
    "Order entregada",
    delivered.status === "delivered",
    `(status=${delivered.status})`,
  );

  const expectedRevenue = Number(product.price) * 3;
  console.log(`  Revenue esperado: ${expectedRevenue}`);

  // 6. Revisar bill y comprobar que se creó la consumption tipo product.
  //
  // Shape real del bill (consumptions.service.ts:53):
  //   { session_id, table_id, status, summary: {...}, items: [...] }
  // summary = { subtotal, discounts_total, adjustments_total,
  //             partial_payments_total, total, item_count }
  // `total` = subtotal + discounts + adjustments + partials (los parciales
  //   son negativos, así que `total` ES "lo que queda por cobrar").
  console.log("\n6) Inspeccionar bill después de entrega");
  const bill1 = await call("GET", `/bill/${session.id}`, { token });
  ok(
    "Consumption(product) registrada",
    bill1.items.some(
      (c) => c.type === "product" && Number(c.amount) === expectedRevenue,
    ),
    `(${bill1.items.length} items)`,
  );
  ok(
    "Bill subtotal = revenue esperado",
    Number(bill1.summary.subtotal) === expectedRevenue,
    `(subtotal=${bill1.summary.subtotal})`,
  );
  ok(
    "Parciales aún en cero",
    Number(bill1.summary.partial_payments_total) === 0,
  );
  ok(
    "Pendiente (total) = subtotal completo",
    Number(bill1.summary.total) === expectedRevenue,
    `(total=${bill1.summary.total})`,
  );

  // 7. Registrar pago parcial = mitad del total
  const partialAmount = Math.floor(expectedRevenue / 2);
  console.log(`\n7) Pago parcial de ${partialAmount}`);
  await call("POST", `/bill/${session.id}/partial-payment`, {
    token,
    body: { amount: partialAmount },
  });

  const bill2 = await call("GET", `/bill/${session.id}`, { token });
  ok(
    "Subtotal SIGUE igual (parcial NO inventa revenue)",
    Number(bill2.summary.subtotal) === expectedRevenue,
    `(subtotal=${bill2.summary.subtotal})`,
  );
  ok(
    "Parcial registrado como negativo",
    Number(bill2.summary.partial_payments_total) === -partialAmount,
    `(partials_total=${bill2.summary.partial_payments_total})`,
  );
  ok(
    "Pendiente (total) = subtotal − parcial",
    Number(bill2.summary.total) === expectedRevenue - partialAmount,
    `(total=${bill2.summary.total})`,
  );

  // 8. Cobrar y cerrar mesa
  console.log("\n8) Cobrar y cerrar mesa");
  const closed = await call(
    "POST",
    `/table-sessions/${session.id}/mark-paid`,
    { token },
  );
  ok(
    "Sesión cerrada y pagada",
    closed.closed_at != null && closed.paid_at != null,
    `(closed_at=${closed.closed_at?.slice(0, 19)}, paid_at=${closed.paid_at?.slice(0, 19)})`,
  );

  // 9. Confirmar que el cierre NO creó consumptions nuevas
  console.log("\n9) Verificar que cerrar NO duplicó ingresos");
  const bill3 = await call("GET", `/bill/${session.id}`, { token });
  ok(
    "Items sin cambios después del cierre",
    bill3.items.length === bill2.items.length,
    `(${bill3.items.length} rows, mismos que antes)`,
  );
  ok(
    "Subtotal sigue siendo el original",
    Number(bill3.summary.subtotal) === expectedRevenue,
  );

  // 10. Verificar contra sales-insights: la venta entra al día de hoy
  console.log("\n10) Verificar en sales-insights (?days=1)");
  const insights = await call("GET", "/admin/sales/insights?days=1", { token });
  const todayRevenue = Number(insights.summary.total_revenue);
  ok(
    "Sales-insights incluye el revenue de la sesión",
    todayRevenue >= expectedRevenue,
    `(total_revenue del día = ${todayRevenue}, debería ser ≥ ${expectedRevenue})`,
  );
  ok(
    "tickets_count > 0",
    Number(insights.summary.tickets_count) >= 1,
    `(tickets=${insights.summary.tickets_count})`,
  );

  console.log("\n=== Done ===\n");
}

main().catch((err) => {
  console.error("\n\x1b[31mFATAL:\x1b[0m", err.message);
  process.exit(1);
});
