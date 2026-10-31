import { describe, expect, it } from "vitest";
import { BudgetError, TIERS, UPLOAD_BUDGET, fitToBudget, fitWithin, type BudgetItem } from "@/lib/imageCompress";

const blobOf = (n: number) => new Blob([new Uint8Array(n)]);
const item = (n: number): BudgetItem => ({ source: blobOf(n), blob: blobOf(n), width: 1600, height: 1000 });

describe("upload budget (hosts cap request bodies at ~4.5 MB)", () => {
  it("keeps the photos untouched when they already fit", async () => {
    let calls = 0;
    const out = await fitToBudget([item(500_000), item(600_000)], async () => { calls += 1; return { blob: blobOf(1), width: 1, height: 1 }; });
    expect(calls).toBe(0);
    expect(out.map((p) => p.blob.size)).toEqual([500_000, 600_000]);
  });
  it("steps down through the tiers until the total fits, re-encoding every photo from its source", async () => {
    const used: number[] = [];
    // 8 photos of 700 KB = 5.6 MB at the first tier. Each lower tier shrinks sizes.
    const items = Array.from({ length: 8 }, () => item(700_000));
    const out = await fitToBudget(items, async (_src, tier) => { used.push(tier.maxSide); return { blob: blobOf(Math.round(700_000 * tier.quality)), width: tier.maxSide, height: 600 }; });
    const total = out.reduce((n, p) => n + p.blob.size, 0);
    expect(total).toBeLessThanOrEqual(UPLOAD_BUDGET);
    expect(used.length % 8).toBe(0); // whole tiers only
    expect(used[0]).toBe(TIERS[1].maxSide); // starts one tier below the default
    expect(out[0].width).toBeLessThan(1600);
  });
  it("gives up with a BudgetError when even the smallest tier is too big", async () => {
    const items = Array.from({ length: 8 }, () => item(700_000));
    await expect(fitToBudget(items, async () => ({ blob: blobOf(700_000), width: 1, height: 1 }))).rejects.toBeInstanceOf(BudgetError);
  });
  it("the first tier is the normal 1600px / 0.8 setting and the budget leaves headroom under 4.5 MB", () => {
    expect(TIERS[0]).toEqual({ maxSide: 1600, quality: 0.8 });
    expect(UPLOAD_BUDGET).toBeLessThan(4.5 * 1024 * 1024 - 500_000);
    for (let i = 1; i < TIERS.length; i++) { expect(TIERS[i].maxSide).toBeLessThan(TIERS[i - 1].maxSide); expect(TIERS[i].quality).toBeLessThan(TIERS[i - 1].quality); }
  });
  it("scales to the tier's longest side", () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 }); // never upscales
  });
});
