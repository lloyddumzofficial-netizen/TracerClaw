export function instructionFingerprint(item) {
  return JSON.stringify({ prompt: item.prompt.trim(), shapes: item.shapes });
}

export function instructionStatus(item) {
  if (item.savedFingerprint === instructionFingerprint(item)) return "Saved";
  return item.savedFingerprint ? "Unsaved changes" : "Draft";
}

export function rectangleConflicts(instructions) {
  const pairs = [];
  for (let a = 0; a < instructions.length; a++) for (let b = a + 1; b < instructions.length; b++) {
    const first = instructions[a].shapes[0], second = instructions[b].shapes[0];
    if (!first || !second) continue;
    if (Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x) > 1e-9
      && Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y) > 1e-9) pairs.push([instructions[a].id, instructions[b].id]);
  }
  return pairs;
}
