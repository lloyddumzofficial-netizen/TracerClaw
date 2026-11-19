import { it, expect } from "vitest";
import { designExtractPrice } from "@/lib/designExtractPricing";
it("sets a fixed tariff for explicit AI operations and refuses unknown operations", () => {
  expect(designExtractPrice("extract")).toBe(2);
  expect(designExtractPrice("split")).toBe(2);
  expect(designExtractPrice("segment")).toBe(1);
  expect(() => designExtractPrice("__proto__")).toThrow();
  expect(() => designExtractPrice("unknown")).toThrow();
});
