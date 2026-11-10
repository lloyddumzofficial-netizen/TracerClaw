import { expect, it } from "vitest";
import { instructionFingerprint, instructionStatus, rectangleConflicts } from "../../src/components/workspace/artwork-editor/instructionState";

const item = (id, x = .1) => ({ id, prompt: "Recolour the lettering.", shapes: [{ kind: "rect", x, y: .2, width: .2, height: .3 }] });

it("requires an explicit saved snapshot and invalidates it when text or geometry changes", () => {
  const draft = item(1); expect(instructionStatus(draft)).toBe("Draft");
  const saved = { ...draft, savedFingerprint: instructionFingerprint(draft) };
  expect(instructionStatus(saved)).toBe("Saved");
  expect(instructionStatus({ ...saved, prompt: "Remove the lettering." })).toBe("Unsaved changes");
  expect(instructionStatus({ ...saved, shapes: [{ ...saved.shapes[0], x: .4 }] })).toBe("Unsaved changes");
  expect(instructionStatus(JSON.parse(JSON.stringify(saved)))).toBe("Saved");
});

it("finds overlapping rectangle pairs without treating touching edges as overlap", () => {
  expect(rectangleConflicts([item(1, 0), item(2, .1), item(3, .5)])).toEqual([[1, 2]]);
  expect(rectangleConflicts([item(1, 0), item(2, .2)])).toEqual([]);
  expect(rectangleConflicts([item(1), { id: 2, shapes: [] }])).toEqual([]);
});
