import { describe, expect, it } from "vitest";
import { isTrackableNavigation } from "@/hooks/useAppRouter";

const CURRENT_URL = "https://desaynclaw.com/workspace/123?panel=front#canvas";

describe("navigation feedback targeting", () => {
  it("tracks internal pathname and query changes", () => {
    expect(isTrackableNavigation("/upscale", CURRENT_URL)).toBe(true);
    expect(isTrackableNavigation("?panel=back", CURRENT_URL)).toBe(true);
  });

  it("ignores the current page and hash-only changes", () => {
    expect(isTrackableNavigation(CURRENT_URL, CURRENT_URL)).toBe(false);
    expect(isTrackableNavigation("#settings", CURRENT_URL)).toBe(false);
  });

  it("ignores external and invalid destinations", () => {
    expect(isTrackableNavigation("https://example.com/upscale", CURRENT_URL)).toBe(false);
    expect(isTrackableNavigation("http://[invalid", CURRENT_URL)).toBe(false);
  });
});
