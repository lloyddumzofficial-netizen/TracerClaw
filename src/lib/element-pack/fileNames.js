export function safeElementPackName(name) {
  return String(name || "Untitled_Design")
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-zA-Z0-9_. -]/g, "_")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 90) || "Untitled_Design";
}

export function elementFileName(index, box) {
  const number = String(index + 1).padStart(2, "0");
  return `elements/element-${number}_${box.width}x${box.height}.png`;
}

