import { describe, it, expect, beforeEach, vi } from "vitest";
import { TableProjectionService } from "../src/modules/table-projection/table-projection.service";

function makeService() {
  const tableUpdate = vi.fn().mockResolvedValue({});
  const prisma = { table: { update: tableUpdate } } as any;
  const svc = new TableProjectionService(prisma);
  return { svc, tableUpdate };
}

describe("TableProjectionService", () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it("onSessionOpened sets status=occupied and current_session_id", async () => {
    await ctx.svc.onSessionOpened(1, 42);
    expect(ctx.tableUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        current_session_id: 42,
        status: "occupied",
      }),
    });
  });

  it("onSessionClosed resets counters and clears session pointer", async () => {
    await ctx.svc.onSessionClosed(1);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data).toMatchObject({
      current_session_id: null,
      status: "available",
      total_consumption: 0,
      active_order_count: 0,
      pending_request_count: 0,
    });
  });

  it("onOrderRequestCreated increments pending_request_count", async () => {
    await ctx.svc.onOrderRequestCreated(1);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.pending_request_count).toEqual({ increment: 1 });
  });

  it("onOrderRequestAccepted swaps counters (pending -> active)", async () => {
    await ctx.svc.onOrderRequestAccepted(1);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.pending_request_count).toEqual({ decrement: 1 });
    expect(call.data.active_order_count).toEqual({ increment: 1 });
  });

  it("onOrderRequestRejected decrements pending only", async () => {
    await ctx.svc.onOrderRequestRejected(1);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.pending_request_count).toEqual({ decrement: 1 });
    expect(call.data.active_order_count).toBeUndefined();
  });

  it("onOrderLeftActive decrements active_order_count", async () => {
    await ctx.svc.onOrderLeftActive(1);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.active_order_count).toEqual({ decrement: 1 });
  });

  it("onConsumptionCreated increments total_consumption", async () => {
    await ctx.svc.onConsumptionCreated(1, 1500);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.total_consumption).toEqual({ increment: 1500 });
  });

  it("onConsumptionReversed decrements total_consumption", async () => {
    await ctx.svc.onConsumptionReversed(1, 1500);
    const call = ctx.tableUpdate.mock.calls[0][0];
    expect(call.data.total_consumption).toEqual({ decrement: 1500 });
  });

  it("uses tx client when provided", async () => {
    const txUpdate = vi.fn().mockResolvedValue({});
    const tx = { table: { update: txUpdate } } as any;
    await ctx.svc.onSessionOpened(1, 42, tx);
    expect(txUpdate).toHaveBeenCalled();
    expect(ctx.tableUpdate).not.toHaveBeenCalled();
  });
});
