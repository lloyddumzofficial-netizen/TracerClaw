import { describe, expect, it } from "vitest";
import { getWorkspaceLabel, getWorkspaceTitle } from "@/lib/workspaceLabels";

describe("workspace labels", () => {
  it("identifies Pattern Workspace without changing existing defaults", () => {
    expect(getWorkspaceTitle("pattern")).toBe("PATTERN WORKSPACE");
    expect(getWorkspaceLabel("pattern")).toBe("Pattern Workspace");
    expect(getWorkspaceTitle("mockup")).toBe("GARMENT WORKSPACE");
    expect(getWorkspaceLabel("mockup")).toBe("Garment Workspace");
  });
});
