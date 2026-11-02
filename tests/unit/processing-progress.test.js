import { describe, expect, it } from "vitest";
import { estimateProcessingProgress } from "@/lib/processingProgress";

describe("workspace display progress estimate", () => {
  it("advances within a stage while waiting for the provider", () => {
    expect(estimateProcessingProgress(0, 0)).toBe(2);
    expect(estimateProcessingProgress(15, 0)).toBeGreaterThan(2);
    expect(estimateProcessingProgress(45, 0)).toBeGreaterThan(estimateProcessingProgress(15, 0));
  });
  it("only enters the next range after the real stage index changes", () => {
    expect(estimateProcessingProgress(99999, 0)).toBe(33);
    expect(estimateProcessingProgress(0, 1)).toBe(34);
    expect(estimateProcessingProgress(99999, 1)).toBe(66);
    expect(estimateProcessingProgress(0, 2)).toBe(67);
    expect(estimateProcessingProgress(99999, 2)).toBe(95);
  });
  it("never reports completed work based only on elapsed time", () => {
    for (const stage of [0, 1, 2]) expect(estimateProcessingProgress(86400, stage)).toBeLessThan(100);
    expect(estimateProcessingProgress(-10, 0)).toBe(2);
    expect(estimateProcessingProgress(Infinity, 0)).toBe(2);
  });
});
