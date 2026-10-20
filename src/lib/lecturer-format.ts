/** Normalize legacy lecturer labels while preserving unrelated lecturer values. */
export function normalizeLecturer(value: unknown): string {
  const label = String(value ?? "").trim();
  const legacy = label.match(/^(.*?)\s*\((\d{4,})\)$/);
  if (!legacy) return label;
  return `${legacy[2]} - ${legacy[1].trim()}`;
}
