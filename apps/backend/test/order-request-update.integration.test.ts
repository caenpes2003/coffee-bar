/**
 * Phase post-H — customer-side edit of a still-pending OrderRequest.
 *
 * Covers:
 *   - happy path: items are replaced, no stock movement
 *   - duplicate items in the body get merged (normalize is reused)
 *   - editing fails after admin accepts (ORDER_REQUEST_NOT_PENDING)
 *   - editing fails on non-existent product / inactive / insufficient stock
 *     (the same checks as create, intentionally — we do not duplicate the
 *     full grid here, only confirm reuse)
 *   - editing fails when the session is closed
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  TableSessionStatus,
  TableStatus,
} from "@prisma/client";
import { ConsumptionsService } from "../src/modules/consumptions/consumptions.service";
import { OrderRequestsService } from "../src/modules/order-requests/order-requests.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { TableProjectionService } from "../src/modules/table-projection/table-projection.service";

const prisma = new PrismaClient();

const noopRealtime = {
  emitOrderRequestCreated: () => {},
  emitOrderRequestUpdated: () => {},
  emitOrderCreated: () => {},
  emitOrderUpdated: () => {},
  emitTableUpdated: () => {},
  emitTableSessionOpened: () => {},
  emitTableSessionUpdated: () => {},
  emitTableSessionClosed: () => {},
  emitQueueUpdated: () => {},
  emitPlaybackUpdated: () => {},
  emitBillUpdated: () => {},
} as any;

const projection = new TableProjectionService(prisma as any);
const consumptions = new ConsumptionsService(
  prisma as any,
  projection,
  noopRealtime,
);
const orderRequests = new OrderRequestsService(
  prisma as any,
  projection,
  noopRealtime,
);
// OrdersService is constructed but only used to test the post-accept block.
const orders = new OrdersService(
  prisma as any,
  projection,
  noopRealtime,
  consumptions,
);
void orders;

let firstTableId = 1;
let firstProductId = 1;
let secondProductId = 2;

async function loadFixtureIds() {
  const [t] = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  if (!t || products.length < 2) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstTableId = t.id;
  firstProductId = products[0].id;
  secondProductId = products[1].id;
}

async function cleanDb() {
  await prisma.consumption.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderRequest.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.table.updateMany({
    data: {
      current_session_id: null,
      status: TableStatus.available,
      total_consumption: 0,
      active_order_count: 0,
      pending_request_count: 0,
      last_activity_at: null,
    },
  });
}

async function resetProduct(id: number, stock: number, isActive = true) {
  await prisma.product.update({
    where: { id },
    data: { stock, is_active: isActive },
  });
}

async function openSession(tableId: number) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.tableSession.create({
      data: { table_id: tableId, status: TableSessionStatus.open },
    });
    await projection.onSessionOpened(tableId, s.id, tx);
    return s;
  });
}

beforeAll(async () => {
  await loadFixtureIds();
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDb();
  await resetProduct(firstProductId, 10, true);
  await resetProduct(secondProductId, 10, true);
});

describe("OrderRequest.updateItems · happy path", () => {
  it("replaces items on a still-pending request without touching stock", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 2 }],
    });

    const productBefore = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(productBefore.stock).toBe(10);

    const updated = await orderRequests.updateItems(req.id, [
      { product_id: firstProductId, quantity: 1 },
      { product_id: secondProductId, quantity: 3 },
    ]);

    // Stock untouched — edit is pre-accept.
    const productAfter = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(productAfter.stock).toBe(10);

    const items = updated.items as Array<{
      product_id: number;
      quantity: number;
    }>;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.product_id === firstProductId)?.quantity).toBe(1);
    expect(items.find((i) => i.product_id === secondProductId)?.quantity).toBe(
      3,
    );
  });

  it("merges duplicate items in the body (reuses normalizeItems)", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });

    const updated = await orderRequests.updateItems(req.id, [
      { product_id: firstProductId, quantity: 2 },
      { product_id: firstProductId, quantity: 1 },
    ]);

    const items = updated.items as Array<{
      product_id: number;
      quantity: number;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });
});

describe("OrderRequest.updateItems · status guard", () => {
  it("rejects with ORDER_REQUEST_NOT_PENDING after admin accepts", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await orderRequests.accept(req.id);

    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 2 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "ORDER_REQUEST_NOT_PENDING" },
    });
  });

  it("rejects with ORDER_REQUEST_NOT_PENDING after customer cancels", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await orderRequests.cancelByCustomer(req.id);

    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 2 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "ORDER_REQUEST_NOT_PENDING" },
    });
  });
});

describe("OrderRequest.updateItems · validation reuse", () => {
  it("rejects when product does not exist", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: 9_999, quantity: 1 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "PRODUCT_NOT_FOUND" },
    });
  });

  it("rejects when product is inactive", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await resetProduct(firstProductId, 10, false);
    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 1 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "PRODUCT_INACTIVE" },
    });
  });

  it("rejects when stock is insufficient", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await resetProduct(firstProductId, 2, true);
    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 5 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "STOCK_INSUFFICIENT" },
    });
  });
});

describe("OrderRequest.updateItems · session policy", () => {
  it("rejects when the session is closed", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });

    await prisma.tableSession.update({
      where: { id: session.id },
      data: { status: TableSessionStatus.closed, closed_at: new Date() },
    });

    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 2 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_CLOSED" },
    });
  });
});
