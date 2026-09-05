import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import { parseDate } from "@/lib/serialize";

/**
 * Pure filter/sort model behind the student exams list (unit-tested).
 * Kept in `lib` so the client island stays a thin view layer and the logic
 * is testable without rendering.
 */

export type AttemptGroupTab = "all" | "todo" | "grading" | "graded" | "review";
export type AttemptSortKey = "newest" | "oldest" | "highest" | "lowest";

export const ATTEMPT_TABS: { key: AttemptGroupTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To take" },
  { key: "grading", label: "Grading" },
  { key: "graded", label: "Graded" },
  { key: "review", label: "Under review" },
];

/** Minimal structural view of a list item — works with serialized attempts. */
export interface FilterableAttempt {
  attempt: {
    status: string;
    score: { percentage: number } | null;
    createdAt: unknown;
  };
  exam: { title: string; subject: string } | null;
}

export function subjectOf(code: string | undefined): string {
  if (!code) return "";
  return SUBJECT_LABELS[code as Subject] ?? code;
}

export function tabOf(status: string): AttemptGroupTab {
  if (status === "pending" || status === "in_progress") return "todo";
  if (status === "submitted") return "grading";
  if (status === "flagged") return "review";
  return "graded";
}

export interface AttemptFilter {
  tab: AttemptGroupTab;
  subject: string;
  sort: AttemptSortKey;
  query: string;
}

const timeOf = (v: unknown) => parseDate(v)?.getTime() ?? 0;

export function filterAndSortAttempts<T extends FilterableAttempt>(
  items: T[],
  { tab, subject, sort, query }: AttemptFilter,
): T[] {
  const q = query.trim().toLowerCase();
  const out = items.filter(({ attempt, exam }) => {
    if (tab !== "all" && tabOf(attempt.status) !== tab) return false;
    if (subject !== "all" && exam?.subject !== subject) return false;
    if (q) {
      const hay = `${exam?.title ?? ""} ${subjectOf(exam?.subject ?? "")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return [...out].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return timeOf(a.attempt.createdAt) - timeOf(b.attempt.createdAt);
      case "highest":
        // Unscored attempts sink to the bottom.
        return (b.attempt.score?.percentage ?? -1) - (a.attempt.score?.percentage ?? -1);
      case "lowest":
        return (a.attempt.score?.percentage ?? 101) - (b.attempt.score?.percentage ?? 101);
      default:
        return timeOf(b.attempt.createdAt) - timeOf(a.attempt.createdAt);
    }
  });
}

export function countByTab<T extends FilterableAttempt>(
  items: T[],
): Record<AttemptGroupTab, number> {
  const counts: Record<AttemptGroupTab, number> = {
    all: items.length,
    todo: 0,
    grading: 0,
    graded: 0,
    review: 0,
  };
  for (const { attempt } of items) counts[tabOf(attempt.status)] += 1;
  return counts;
}
