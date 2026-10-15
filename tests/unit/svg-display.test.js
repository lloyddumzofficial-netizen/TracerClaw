import { describe, expect, it } from "vitest";
import { scaleSvgToContainer } from "../../src/lib/svgDisplay.js";

describe("SVG preview sizing", () => {
  it("preserves provider aspect-ratio semantics for portrait SVG output", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" style="display:block" viewBox="0 0 3072 3072" width="1792" height="3072" preserveAspectRatio="none"><path d="M0 0h3072v3072H0z"/></svg>';
    const result = scaleSvgToContainer(source);

    expect(result).toContain('width="1792"');
    expect(result).toContain('height="3072"');
    expect(result).toContain('viewBox="0 0 3072 3072"');
    expect(result).toContain('preserveAspectRatio="none"');
    expect(result).toContain("width:auto;height:auto;max-width:100%;max-height:100%");
    expect(result).not.toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("adds a viewBox when a dimensioned SVG does not provide one", () => {
    const result = scaleSvgToContainer('<svg width="505" height="866"><path/></svg>');

    expect(result).toContain('viewBox="0 0 505 866"');
  });

  it("fills the preview for viewBox-only SVGs without inventing new geometry", () => {
    const result = scaleSvgToContainer('<svg viewBox="0 0 400 700"><path/></svg>');

    expect(result).toContain('style="width:100%;height:100%;display:block;"');
    expect(result).toContain('viewBox="0 0 400 700"');
  });
});
