/**
 * Pure pagination + directory-search helpers for the platform lists — no I/O,
 * unit-tested, shared by every super-admin directory.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Offset for a 1-based page number, clamped to ≥ 0. */
export function offsetForPage(page: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  const p = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const size = Math.max(1, Math.floor(pageSize));
  return (p - 1) * size;
}

export function totalPages(total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  const size = Math.max(1, Math.floor(pageSize));
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** Clamp a requested page into the valid range for a total. */
export function clampPage(page: number, total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), totalPages(total, pageSize));
}

/**
 * Compact page-number window with ellipsis markers, e.g. for page 7 of 20:
 * [1, "…", 6, 7, 8, "…", 20]. Numbers are page numbers; "…" strings render as
 * separators.
 */
export function pageWindow(
  current: number,
  total: number,
  size = 1,
): (number | "…")[] {
  const last = totalPages(total, size);
  const cur = clampPage(current, total, size);
  if (last <= 7) {
    return Array.from({ length: last }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, last, cur - 1, cur, cur + 1]);
  if (cur <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (cur >= last - 2) [last - 3, last - 2, last - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);

  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Firestore range for a "starts with" search on a name/email field — the
 * standard lexicographic prefix trick. Empty queries return null (no filter).
 */
export function namePrefixRange(
  query: string | null | undefined,
): { start: string; end: string } | null {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return null;
  return { start: q, end: `${q}\uf8ff` };
}

/** Dedupe + drop empties from a recipient list. */
export function dedupeIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id && id.trim())))];
}
