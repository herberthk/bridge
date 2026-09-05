"use client";

import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  FileCheck2Icon,
  FlameIcon,
  HelpCircleIcon,
  HistoryIcon,
  SearchIcon,
  TimerIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentAttemptListItem } from "@/server/services/attempts";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import {
  ATTEMPT_TABS,
  countByTab,
  filterAndSortAttempts,
  subjectOf,
  type AttemptGroupTab,
  type AttemptSortKey,
} from "@/lib/exam/attempt-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AttemptWithExam {
  /** Projected attempt (list fields only — answers are not sent to clients). */
  attempt: SerializedWithId<StudentAttemptListItem>;
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    questionCount: number;
  } | null;
}

// ─── Status configuration ─────────────────────────────────────────────────────

type StatusKey = "pending" | "in_progress" | "submitted" | "graded" | "flagged";

const STATUS_META: Record<
  StatusKey,
  {
    label: string;
    color: string;
    dot: string;
  }
> = {
  pending: {
    label: "Ready",
    color: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  in_progress: {
    label: "In progress",
    color: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500 animate-pulse",
  },
  submitted: {
    label: "Grading…",
    color: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500 animate-pulse",
  },
  graded: {
    label: "Graded",
    color: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  flagged: {
    label: "Under review",
    color: "text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
  },
};

function getStatusMeta(status: string) {
  return STATUS_META[status as StatusKey] ?? {
    label: status,
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
  };
}

function scoreTone(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function scoreBar(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

/** True once hydrated on the client — gates `Date.now()`-derived UI so SSR
 *  HTML and hydration agree, then reveals relative-time badges. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Urgency of a waiting attempt relative to its scheduled date. */
function urgencyOf(scheduledFor: unknown, status: string): "overdue" | "due-soon" | null {
  if (status !== "pending") return null;
  const d = parseDate(scheduledFor);
  if (!d) return null;
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "overdue";
  if (diff <= 24 * 60 * 60 * 1000) return "due-soon";
  return null;
}

// ─── Pagination constant ──────────────────────────────────────────────────────

const PAGE_SIZE = 9;

// ─── Upcoming exam card ───────────────────────────────────────────────────────

function UpcomingCard({ attempt, exam }: AttemptWithExam) {
  const meta = getStatusMeta(attempt.status);
  const mounted = useMounted();
  const isRetake = !!attempt.retakeOf;
  const active = attempt.status === "in_progress";
  // Relative-time badges render only after mount (see useMounted).
  const urgency = mounted ? urgencyOf(attempt.scheduledFor, attempt.status) : null;
  const scheduled = parseDate(attempt.scheduledFor);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border bg-card p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lifted">
      {/* Top accent */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-1",
          active
            ? "bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500"
            : "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500",
        )}
      />

      <div className="flex items-start justify-between gap-3 pt-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl",
              active
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {active ? <FlameIcon className="size-5" /> : <BookOpenCheckIcon className="size-5" />}
          </span>
          <div className="min-w-0">
            {exam && (
              <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {subjectOf(exam.subject)}
              </p>
            )}
            <p className="truncate font-semibold leading-snug">{exam?.title ?? "Exam"}</p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          <span className={cn("text-xs font-semibold", meta.color)}>{meta.label}</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {isRetake && (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 px-2 py-0 text-[11px] text-amber-700 dark:text-amber-400"
          >
            Retake
          </Badge>
        )}
        {urgency === "overdue" && (
          <Badge variant="destructive" className="px-2 py-0 text-[11px]">
            Due now
          </Badge>
        )}
        {urgency === "due-soon" && scheduled && (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 px-2 py-0 text-[11px] text-amber-700 tabular-nums dark:text-amber-400"
          >
            Due {formatDistanceToNow(scheduled, { addSuffix: true })}
          </Badge>
        )}
      </div>

      {/* Meta grid — duration, questions, schedule at a glance */}
      <dl className="mt-4 grid grid-cols-3 divide-x divide-border rounded-2xl border bg-muted/40 text-center">
        <div className="px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <TimerIcon className="size-3" /> Time
          </dt>
          <dd className="mt-0.5 text-sm font-bold tabular-nums">
            {exam?.durationMinutes ?? "–"}
            <span className="font-medium text-muted-foreground"> min</span>
          </dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <HelpCircleIcon className="size-3" /> Items
          </dt>
          <dd className="mt-0.5 text-sm font-bold tabular-nums">{exam?.questionCount ?? "–"}</dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <ClockIcon className="size-3" /> Date
          </dt>
          <dd className="mt-0.5 truncate text-sm font-bold tabular-nums">
            {scheduled ? format(scheduled, "d MMM") : "—"}
            <span className="block truncate text-[11px] font-medium text-muted-foreground">
              {scheduled ? format(scheduled, "HH:mm") : "Flexible"}
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex-1" />
      <Button
        className={cn(!active && "shadow-glow")}
        variant={active ? "outline" : "default"}
        nativeButton={false}
        render={<Link href={`/exam/${attempt.id}`} />}
      >
        {active ? "Continue exam" : "Start when ready"}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </div>
  );
}

// ─── Completed exam row ───────────────────────────────────────────────────────

function CompletedRow({ attempt, exam }: AttemptWithExam) {
  const meta = getStatusMeta(attempt.status);
  const score = attempt.score;
  const submitted = parseDate(attempt.submittedAt);
  const graded = parseDate(attempt.gradedAt);

  return (
    <div className="group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40">
      <Link
        href={`/student/results/${attempt.id}`}
        aria-label={`View results for ${exam?.title ?? "exam"}`}
        className="absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <span className="pointer-events-none flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
        <FileCheck2Icon className="size-4" />
      </span>
      <span className="pointer-events-none min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold">{exam?.title ?? "Exam"}</span>
          {attempt.retakeOf && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
            >
              Retake
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {exam ? `${subjectOf(exam.subject)} · ` : ""}
          {submitted ? format(submitted, "d MMM yyyy") : "—"}
          {graded && attempt.status === "graded"
            ? ` · graded ${format(graded, "d MMM")}`
            : ""}
          {score ? ` · ${score.earned}/${score.possible} marks` : ""}
        </span>
      </span>
      {exam && (
        <Link
          href={`/student/exams/${exam.id}`}
          className="relative z-10 hidden shrink-0 items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 hover:underline sm:flex"
        >
          <HistoryIcon className="size-3" />
          History
        </Link>
      )}
      <span className="pointer-events-none relative w-28 shrink-0 sm:w-32">
        {score ? (
          <span className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Score</span>
              <span className={cn("font-bold tabular-nums", scoreTone(score.percentage))}>
                {score.percentage}%
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", scoreBar(score.percentage))}
                style={{ width: `${score.percentage}%` }}
              />
            </span>
          </span>
        ) : (
          <span className="flex items-center justify-end gap-1.5">
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            <span className={cn("text-xs font-semibold", meta.color)}>{meta.label}</span>
          </span>
        )}
      </span>
    </div>
  );
}

// ─── Pagination controls ──────────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }
  return (
    <div className="flex items-center justify-between border-t px-5 py-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-8 items-center justify-center text-xs text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPage(p)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                p === page ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent",
              )}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component (the only client JS on the page) ──────────────────────────

export function StudentExamsList({ items }: { items: AttemptWithExam[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<AttemptGroupTab>("all");
  const [subject, setSubject] = useState("all");
  const [sort, setSort] = useState<AttemptSortKey>("newest");
  const [page, setPage] = useState(1);
  // Defer the query so keystrokes stay at 60fps while a long list re-filters.
  const deferredQuery = useDeferredValue(query);

  const subjects = useMemo(() => {
    const set = new Map<string, string>();
    for (const { exam } of items) {
      if (exam && !set.has(exam.subject)) set.set(exam.subject, subjectOf(exam.subject));
    }
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const tabCounts = useMemo(() => countByTab(items), [items]);

  const filtered = useMemo(
    () => filterAndSortAttempts(items, { tab, subject, sort, query: deferredQuery }),
    [items, tab, subject, sort, deferredQuery],
  );

  const upcoming = useMemo(
    () =>
      filtered.filter(
        ({ attempt }) => attempt.status === "pending" || attempt.status === "in_progress",
      ),
    [filtered],
  );
  const past = useMemo(
    () =>
      filtered.filter(
        ({ attempt }) => attempt.status !== "pending" && attempt.status !== "in_progress",
      ),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(past.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedPast = past.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  // Keyed off the live query so the empty state flips the instant the user
  // types, not after the deferred filter catches up.
  const isFiltering = tab !== "all" || subject !== "all" || query.trim() !== "";

  function resetPage() {
    setPage(1);
  }

  function handlePageChange(p: number) {
    setPage(p);
    document.getElementById("completed-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* ── Toolbar: search + filters + selects (the interactive island) ── */}
      <div className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-card sm:p-5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPage();
            }}
            placeholder="Search by exam title or subject…"
            aria-label="Search exams"
            className="h-11 rounded-2xl pr-9 pl-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                resetPage();
              }}
              className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap items-center gap-1 rounded-2xl bg-muted/60 p-1"
            role="group"
            aria-label="Filter by status"
          >
            {ATTEMPT_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  resetPage();
                }}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-semibold transition-all tabular-nums",
                  tab === t.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className="ml-1.5 opacity-60">{tabCounts[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {subjects.length > 1 && (
              <select
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by subject"
                className="h-9 rounded-xl border bg-card px-2.5 text-xs font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All subjects</option>
                {subjects.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as AttemptSortKey);
                resetPage();
              }}
              aria-label="Sort exams"
              className="h-9 rounded-xl border bg-card px-2.5 text-xs font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest">Highest score</option>
              <option value="lowest">Lowest score</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Upcoming / active exams ── */}
      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-heading">
          <h2
            id="upcoming-heading"
            className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          >
            Upcoming &amp; active · {upcoming.length}
          </h2>
          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map(({ attempt, exam }) => (
              <UpcomingCard key={attempt.id} attempt={attempt} exam={exam} />
            ))}
          </div>
        </section>
      )}

      {/* ── Completed exams ── */}
      {past.length > 0 && (
        <section id="completed-section" aria-labelledby="completed-heading" className="scroll-mt-24">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="completed-heading"
              className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
            >
              Completed · {past.length}
            </h2>
            {past.length > PAGE_SIZE && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, past.length)} of {past.length}
              </p>
            )}
          </div>
          <div className="overflow-hidden rounded-3xl border bg-card shadow-card">
            <div className="divide-y">
              {pagedPast.map(({ attempt, exam }) => (
                <CompletedRow key={attempt.id} attempt={attempt} exam={exam} />
              ))}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={handlePageChange} />
          </div>
        </section>
      )}

      {/* ── Empty states ── */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            {isFiltering ? (
              <SearchIcon className="size-7" />
            ) : (
              <CheckCircle2Icon className="size-7" />
            )}
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">
              {isFiltering ? "No exams match your filters" : "Nothing here yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
              {isFiltering
                ? "Try a different search term, subject, or status tab."
                : "When your teacher assigns an exam it shows up here with its schedule and duration."}
            </p>
          </div>
          {isFiltering ? (
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setTab("all");
                setSubject("all");
                resetPage();
              }}
            >
              Clear filters
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ClipboardListIcon className="size-4" />
              Assigned exams appear automatically
            </div>
          )}
        </div>
      )}
    </div>
  );
}
