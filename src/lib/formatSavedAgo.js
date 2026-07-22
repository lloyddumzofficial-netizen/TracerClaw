export function formatSavedAgo(updatedAt) {
  if (!updatedAt) return null;

  const diff = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
  if (diff < 1) return "Saved just now";
  if (diff === 1) return "Saved 1 minute ago";
  if (diff < 60) return `Saved ${diff} minutes ago`;
  return "Saved recently";
}
