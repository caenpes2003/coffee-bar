import { describe, expect, it, vi } from "vitest";
import { ProductAvailabilityService } from "../src/modules/products/product-availability.service";
import { ProductsService } from "../src/modules/products/products.service";

function slot(stocks: number[], quantity = 6, product_id = 100) {
  return {
    product_id,
    quantity,
    options: stocks.map((stock, i) => ({
      component: { id: i + 1, stock, is_active: true },
    })),
  };
}

function setup(slots: ReturnType<typeof slot>[]) {
  const prisma = {
    productRecipeSlot: { findMany: vi.fn().mockResolvedValue(slots) },
    product: { findMany: vi.fn().mockResolvedValue([
      { id: 100, price: 30000, stock: 999, min_stock: 2, is_active: true },
      { id: 200, price: 5000, stock: 0, min_stock: 2, is_active: true },
    ]) },
  };
  const availability = new ProductAvailabilityService(prisma as any);
  const realtime = { emitProductUpdated: vi.fn() };
  const products = new ProductsService(prisma as any, availability, realtime as any);
  return { prisma, availability, realtime, products };
}

describe("composite availability", () => {
  it.each([
    [[0, 2, 2, 2], 1],
    [[2, 0, 2, 2], 1],
    [[2, 2, 0, 2], 1],
    [[2, 2, 2, 0], 1],
    [[0, 0, 3, 3], 1],
    [[0, 0, 0, 6], 1],
    [[0, 5, 5, 5], 2],
    [[1, 1, 1, 3], 1],
    [[0, 1, 2, 2], 0],
    [[0, 0, 0, 0], 0],
  ])("mix stocks %j allow %i complete buckets", async (stocks, expected) => {
    const { availability } = setup([slot(stocks)]);
    expect((await availability.computeForProducts([100])).get(100)).toEqual({
      status: expected > 0 ? "available" : "out_of_stock",
      derived_stock: expected,
    });
  });

  it("still requires every mandatory slot of a fixed recipe", async () => {
    const { availability } = setup([slot([20], 2), slot([0], 1)]);
    expect((await availability.computeForProducts([100])).get(100)).toEqual({
      status: "out_of_stock", derived_stock: 0,
    });
  });

  it("uses the scarcest slot to count complete products", async () => {
    const { availability } = setup([slot([0, 18]), slot([2], 1)]);
    expect((await availability.computeForProducts([100])).get(100)).toEqual({
      status: "available", derived_stock: 2,
    });
  });

  it.each([slot([], 6), slot([20], 0)])("blocks an invalid slot %j", async (invalid) => {
    const { availability } = setup([invalid]);
    expect((await availability.computeForProducts([100])).get(100)).toEqual({
      status: "out_of_stock", derived_stock: 0,
    });
  });

  it("leaves simple products to their own stock check", async () => {
    const { availability } = setup([]);
    expect((await availability.computeForProducts([200])).has(200)).toBe(false);
  });

  it("skips the database for an empty catalog", async () => {
    const { prisma, availability } = setup([]);
    expect(await availability.computeForProducts([])).toEqual(new Map());
    expect(prisma.productRecipeSlot.findMany).not.toHaveBeenCalled();
  });

  it("updates customer catalog, admin catalog and realtime consistently", async () => {
    const { products, realtime } = setup([slot([0, 2, 2, 2])]);
    const expected = { id: 100, availability: "available", derived_stock: 1, is_out_of_stock: false };
    for (const catalog of [await products.findAllForCustomers(), await products.findAllForAdmin()]) {
      expect(catalog[0]).toMatchObject(expected);
      expect(catalog[1]).toMatchObject({ id: 200, is_out_of_stock: true });
      expect(catalog[1].availability).toBeUndefined();
    }
    await products.broadcastChanged();
    expect(realtime.emitProductUpdated).toHaveBeenCalledWith({
      products: expect.arrayContaining([expect.objectContaining(expected)]),
    });
  });
});
