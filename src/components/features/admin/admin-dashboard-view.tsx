"use client";

import { useMemo, useState, useCallback, Fragment } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  AwardIcon,
  BarChart3Icon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronUpIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LayoutGridIcon,
  LayoutListIcon,
  PercentIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  TrendingUpIcon,
  WalletCardsIcon,
  XIcon,
} from "lucide-react";

import type { AdminDashboardData } from "@/server/services/analytics";
import { formatTokens, formatUsd, STANDARD_EXAM_TOKEN_ESTIMATE, tokensToUsd } from "@/lib/pricing";
import { isSchoolAdminWorkspace } from "@/lib/admin-ui";
import { AnimatedCounter, FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDisplay,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  CategoryBars,
  ChartCard,
} from "@/components/features/dashboard/charts";

// ─── Types & Configuration ──────────────────────────────────────────────────

export interface AdminActor {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  role: string;
  schoolId?: string | null;
}

type SortField =
  | "title"
  | "subject"
  | "totalAttempts"
  | "gradedCount"
  | "avgScore"
  | "retakeCount"
  | "maxFailRate";
type SortDir = "asc" | "desc";
type ScoreFilter = "all" | "high" | "medium" | "low" | "retakes";
type ViewMode = "table" | "grid";

const SCORE_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All Performance Levels" },
  { value: "high", label: "High Scoring (≥ 70%)" },
  { value: "medium", label: "Average (50% – 69%)" },
  { value: "low", label: "Needs Attention (< 50%)" },
  { value: "retakes", label: "Has Retakes" },
];

const SORT_FIELD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "totalAttempts", label: "Sort by Total Attempts" },
  { value: "avgScore", label: "Sort by Average Score" },
  { value: "retakeCount", label: "Sort by Retakes Count" },
  { value: "maxFailRate", label: "Sort by Question Fail Rate" },
  { value: "title", label: "Sort by Exam Title" },
  { value: "gradedCount", label: "Sort by Graded Count" },
];

const SUBJECT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  mathematics: { bg: "bg-blue-500/10 dark:bg-blue-500/20", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
  english: { bg: "bg-amber-500/10 dark:bg-amber-500/20", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" },
  science: { bg: "bg-emerald-500/10 dark:bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
  social_studies: { bg: "bg-purple-500/10 dark:bg-purple-500/20", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/20" },
  physics: { bg: "bg-cyan-500/10 dark:bg-cyan-500/20", text: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-500/20" },
  chemistry: { bg: "bg-teal-500/10 dark:bg-teal-500/20", text: "text-teal-600 dark:text-teal-400", border: "border-teal-500/20" },
  biology: { bg: "bg-lime-500/10 dark:bg-lime-500/20", text: "text-lime-600 dark:text-lime-400", border: "border-lime-500/20" },
  geography: { bg: "bg-orange-500/10 dark:bg-orange-500/20", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/20" },
  history: { bg: "bg-rose-500/10 dark:bg-rose-500/20", text: "text-rose-600 dark:text-rose-400", border: "border-rose-500/20" },
  computer_studies: { bg: "bg-indigo-500/10 dark:bg-indigo-500/20", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-500/20" },
  commerce: { bg: "bg-violet-500/10 dark:bg-violet-500/20", text: "text-violet-600 dark:text-violet-400", border: "border-violet-500/20" },
  agriculture: { bg: "bg-green-500/10 dark:bg-green-500/20", text: "text-green-600 dark:text-green-400", border: "border-green-500/20" },
  economics_entrepreneurship: { bg: "bg-yellow-500/10 dark:bg-yellow-500/20", text: "text-yellow-600 dark:text-yellow-400", border: "border-yellow-500/20" },
};

function getSubjectBadge(subject: string) {
  const normalized = subject.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const match = Object.keys(SUBJECT_COLORS).find((k) => normalized.includes(k));
  return match
    ? SUBJECT_COLORS[match]
    : { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" };
}

function getScoreBadge(score: number | null) {
  if (score === null) {
    return { label: "Ungraded", color: "text-muted-foreground bg-muted border-border", bar: "bg-muted-foreground/30" };
  }
  if (score >= 75) {
    return { label: "Excellent", color: "text-emerald-700 bg-emerald-500/15 border-emerald-500/30 dark:text-emerald-400", bar: "bg-emerald-500" };
  }
  if (score >= 55) {
    return { label: "Average", color: "text-blue-700 bg-blue-500/15 border-blue-500/30 dark:text-blue-400", bar: "bg-blue-500" };
  }
  if (score >= 40) {
    return { label: "Pass", color: "text-amber-700 bg-amber-500/15 border-amber-500/30 dark:text-amber-400", bar: "bg-amber-500" };
  }
  return { label: "Needs Focus", color: "text-rose-700 bg-rose-500/15 border-rose-500/30 dark:text-rose-400", bar: "bg-rose-500" };
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AdminDashboardView({
  data,
  actor,
  loadFailed,
}: {
  data: AdminDashboardData | null;
  actor: AdminActor;
  loadFailed?: boolean;
}) {
  // ─── Extract Data Properties (React Compiler friendly) ──────────────────────
  const perExamDetailed = data?.perExamDetailed ?? [];
  const studentCount = data?.studentCount ?? 0;
  const examCount = data?.examCount ?? 0;
  const attemptsTotal = data?.attemptsTotal ?? 0;
  const averageScore = data?.averageScore ?? null;
  const retakesTotal = data?.retakesTotal ?? 0;
  const retakeRate = data?.retakeRate ?? 0;
  const walletBalance = data?.walletBalance ?? 0;
  const tokensConsumed = data?.tokensConsumed ?? 0;
  const attemptsByDay = data?.attemptsByDay ?? [];
  const bySubject = data?.bySubject ?? [];
  const retakesByExam = data?.retakesByExam ?? [];

  // ─── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [sortField, setSortField] = useState<SortField>("totalAttempts");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);

  // ─── Derived Subject List ───────────────────────────────────────────────────
  const uniqueSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const e of perExamDetailed) {
      if (e.subject) set.add(e.subject);
    }
    return Array.from(set).sort();
  }, [perExamDetailed]);

  // ─── Filtered Detailed Exams ────────────────────────────────────────────────
  const filteredExams = useMemo(() => {
    return perExamDetailed.filter((item) => {
      // Search match
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesSubject = item.subject.toLowerCase().includes(q);
        const matchesId = item.examId.toLowerCase().includes(q);
        if (!matchesTitle && !matchesSubject && !matchesId) return false;
      }

      // Subject match
      if (subjectFilter !== "all") {
        if (item.subject.toLowerCase() !== subjectFilter.toLowerCase()) return false;
      }

      // Score filter
      if (scoreFilter === "high") {
        if (item.avgScore === null || item.avgScore < 70) return false;
      } else if (scoreFilter === "medium") {
        if (item.avgScore === null || item.avgScore < 50 || item.avgScore >= 70) return false;
      } else if (scoreFilter === "low") {
        if (item.avgScore === null || item.avgScore >= 50) return false;
      } else if (scoreFilter === "retakes") {
        if (item.retakeCount <= 0) return false;
      }

      return true;
    });
  }, [perExamDetailed, search, subjectFilter, scoreFilter]);

  // ─── Sorted Exams ───────────────────────────────────────────────────────────
  const sortedExams = useMemo(() => {
    return [...filteredExams].sort((a, b) => {
      let comparison = 0;
      if (sortField === "title") {
        comparison = a.title.localeCompare(b.title);
      } else if (sortField === "subject") {
        comparison = a.subject.localeCompare(b.subject);
      } else if (sortField === "totalAttempts") {
        comparison = a.totalAttempts - b.totalAttempts;
      } else if (sortField === "gradedCount") {
        comparison = a.gradedCount - b.gradedCount;
      } else if (sortField === "avgScore") {
        const scoreA = a.avgScore ?? -1;
        const scoreB = b.avgScore ?? -1;
        comparison = scoreA - scoreB;
      } else if (sortField === "retakeCount") {
        comparison = a.retakeCount - b.retakeCount;
      } else if (sortField === "maxFailRate") {
        const maxFailA = Math.max(0, ...a.failedQuestionRates.map((q) => q.failRate));
        const maxFailB = Math.max(0, ...b.failedQuestionRates.map((q) => q.failRate));
        comparison = maxFailA - maxFailB;
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [filteredExams, sortField, sortDir]);

  // ─── Pagination Math ────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sortedExams.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedExams = sortedExams.slice(startIndex, startIndex + pageSize);

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
      setPage(1);
    },
    [sortField],
  );

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setSubjectFilter("all");
    setScoreFilter("all");
    setPage(1);
  }, []);

  const hasActiveFilters = search || subjectFilter !== "all" || scoreFilter !== "all";

  const toggleRowExpand = useCallback((examId: string) => {
    setExpandedExamId((prev) => (prev === examId ? null : examId));
  }, []);

  // ─── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (sortedExams.length === 0) {
      toast.error("No exams to export");
      return;
    }

    const headers = [
      "Exam ID",
      "Title",
      "Subject",
      "Total Attempts",
      "Graded Submissions",
      "Average Score (%)",
      "Retakes Count",
      "Top Tricky Question",
      "Top Question Fail Rate (%)",
      "Top Question Skip Rate (%)",
    ];

    const rows = sortedExams.map((e) => {
      const topQ = e.failedQuestionRates[0];
      return [
        `"${e.examId}"`,
        `"${e.title.replace(/"/g, '""')}"`,
        `"${e.subject}"`,
        e.totalAttempts,
        e.gradedCount,
        e.avgScore !== null ? e.avgScore : "N/A",
        e.retakeCount,
        topQ ? `"${topQ.prompt.replace(/"/g, '""')}"` : "N/A",
        topQ ? topQ.failRate : "0",
        topQ ? topQ.skippedRate : "0",
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", objectUrl);
    link.setAttribute("download", `exam_assessment_report_${format(new Date(), "yyyyMMdd_HHmm")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    toast.success(`Exported assessment data for ${sortedExams.length} exams as CSV`);
  }, [sortedExams]);

  // ─── Copy Summary to Clipboard ──────────────────────────────────────────────
  const handleCopySummary = useCallback(async () => {
    const summary = [
      `📊 Bridge Admin Summary — ${format(new Date(), "d MMMM yyyy")}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `• Students Enrolled: ${studentCount}`,
      `• Total Exams Created: ${examCount}`,
      `• Total Submissions: ${attemptsTotal}`,
      `• Average Cohort Score: ${averageScore !== null ? `${averageScore}%` : "N/A"}`,
      `• Approved Retakes: ${retakesTotal} (${retakeRate}% rate)`,
      `• Wallet Balance: ${formatTokens(walletBalance)} tokens`,
      `• Tokens Consumed: ${formatTokens(tokensConsumed)} tokens`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Top Assessed Exams:`,
      ...sortedExams.slice(0, 5).map(
        (e, i) =>
          ` ${i + 1}. ${e.title} (${e.subject}) — ${e.totalAttempts} attempts, avg ${e.avgScore !== null ? `${e.avgScore}%` : "—"}, ${e.retakeCount} retakes`,
      ),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Executive summary copied to clipboard!");
    } catch {
      toast.error("Could not copy the executive summary");
    }
  }, [
    studentCount,
    examCount,
    attemptsTotal,
    averageScore,
    retakesTotal,
    retakeRate,
    walletBalance,
    tokensConsumed,
    sortedExams,
  ]);

  // Estimated exams remaining based on one standard grounded exam per
  // STANDARD_EXAM_TOKEN_ESTIMATE (see lib/pricing).
  const estimatedGenerationsLeft = Math.floor(walletBalance / STANDARD_EXAM_TOKEN_ESTIMATE);
  // Captured once per mount — avoids re-creating "today" on every render.
  const [todayLabel] = useState(() => format(new Date(), "EEEE, d MMMM yyyy"));
  const isSchoolAdmin = isSchoolAdminWorkspace(actor);
  // Onboarding card shows only for new school-admin workspaces — standalone
  // instructor workspaces can't invite teachers or create classes.
  const isNewSchoolWorkspace = examCount === 0 && attemptsTotal === 0 && isSchoolAdmin;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {/* ─── Hero Header Banner ─── */}
        <FadeIn className="bg-card shadow-card relative overflow-hidden rounded-2xl border p-6 sm:p-7">
          <div className="from-brand/5 via-brand/0 to-transparent pointer-events-none absolute inset-0 bg-linear-to-r" />
          <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 font-normal">
                  <span className="bg-emerald-500 inline-block size-2 rounded-full ring-2 ring-emerald-500/20" />
                  {actor.schoolId ? "School Administration" : "Instructor Workspace"}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  • {todayLabel}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {actor.displayName ? `Welcome, ${actor.displayName}` : "Admin Command Center"}
              </h1>
              <p className="text-muted-foreground mt-1 max-w-2xl text-xs sm:text-sm">
                Comprehensive real-time analytics on student assessments, examination trends,
                diagnostic fail rates, and AI token utilization.
              </p>
            </div>

            {/* Header Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopySummary}
                className="h-9 gap-1.5 text-xs shadow-xs"
              >
                <CopyIcon className="size-3.5" />
                <span className="hidden sm:inline">Copy</span> Summary
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                className="h-9 gap-1.5 text-xs shadow-xs"
              >
                <DownloadIcon className="size-3.5" />
                <span className="hidden sm:inline">Export</span> CSV
              </Button>

              <Button
                className="shadow-glow h-9 gap-2 text-xs font-semibold"
                nativeButton={false}
                render={<Link href="/admin/classes" />}
              >
                <SparklesIcon className="size-4" />
                <span>New AI Exam</span>
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        </FadeIn>

        {/* ─── Error / Stale Notification ─── */}
        {loadFailed && (
          <div className="text-destructive flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <AlertCircleIcon className="size-5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Dashboard telemetry could not be loaded</p>
              <p className="text-xs opacity-90">
                Metrics shown below may be cached or incomplete. Please check your network connection
                or reload the page.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="text-destructive border-destructive/30 hover:bg-destructive/20 h-7 text-xs"
            >
              <RefreshCwIcon className="mr-1 size-3" /> Reload
            </Button>
          </div>
        )}

        {/* ─── Getting started (new school-admin workspaces) ─── */}
        {isNewSchoolWorkspace && !loadFailed && (
          <div className="shadow-card rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <h2 className="text-sm font-semibold">Get your school live in three steps</h2>
                <ol className="text-muted-foreground mt-2 flex flex-col gap-1.5 text-xs sm:text-sm">
                  <li>
                    <Link href="/admin/teachers" className="text-primary font-medium hover:underline">
                      1. Invite teachers
                    </Link>{" "}
                    — they accept a secure link and appear in your roster.
                  </li>
                  <li>
                    <Link href="/admin/classes" className="text-primary font-medium hover:underline">
                      2. Create a class
                    </Link>{" "}
                    — group students before assigning exams.
                  </li>
                  <li>
                    <Link href="/admin/classes" className="text-primary font-medium hover:underline">
                      3. Generate your first AI exam
                    </Link>{" "}
                    — aligned to UNEB curricula in under a minute.
                  </li>
                </ol>
              </div>
              <Button
                className="shadow-glow h-9 gap-2 self-start text-xs font-semibold md:self-center"
                nativeButton={false}
                render={<Link href="/admin/classes" />}
              >
                <SparklesIcon className="size-4" />
                Get started
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── Executive KPI Cards Grid (6 Columns) ─── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {/* Card 1: Students */}
          <Link href="/admin/students" className="group block focus:outline-none">
            <Card className="shadow-card group-hover:border-primary/40 group-hover:shadow-md relative overflow-hidden transition-all">
              <div className="p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs font-medium">Students</span>
                  <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                    <GraduationCapIcon className="size-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <p className="text-2xl font-bold tracking-tight tabular-nums">
                    <AnimatedCounter value={studentCount} />
                  </p>
                  <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                    <span className="bg-emerald-500 inline-block size-1.5 rounded-full" />
                    Enrolled &amp; active
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          {/* Card 2: Exams Created */}
          <Link href="/admin/exams" className="group block focus:outline-none">
            <Card className="shadow-card group-hover:border-primary/40 group-hover:shadow-md relative overflow-hidden transition-all">
              <div className="p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs font-medium">Exams Created</span>
                  <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 flex size-8 items-center justify-center rounded-lg">
                    <FileTextIcon className="size-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  <p className="text-2xl font-bold tracking-tight tabular-nums">
                    <AnimatedCounter value={examCount} />
                  </p>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {uniqueSubjects.length} subject{uniqueSubjects.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          {/* Card 3: Total Attempts */}
          <Card className="shadow-card relative overflow-hidden">
            <div className="p-4.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Submissions</span>
                <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex size-8 items-center justify-center rounded-lg">
                  <ClipboardCheckIcon className="size-4" />
                </div>
              </div>
              <div className="mt-2.5">
                <p className="text-2xl font-bold tracking-tight tabular-nums">
                  <AnimatedCounter value={attemptsTotal} />
                </p>
                <p className="text-muted-foreground mt-1 text-[11px]">
                  Total student attempts
                </p>
              </div>
            </div>
          </Card>

          {/* Card 4: Average Score */}
          <Card className="shadow-card relative overflow-hidden">
            <div className="p-4.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Avg Score</span>
                <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-8 items-center justify-center rounded-lg">
                  <AwardIcon className="size-4" />
                </div>
              </div>
              <div className="mt-2.5">
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold tracking-tight tabular-nums">
                    <AnimatedCounter value={averageScore ?? 0} />
                  </p>
                  <span className="text-muted-foreground text-sm font-semibold">%</span>
                </div>
                <p className="text-muted-foreground mt-1 text-[11px]">Across graded exams</p>
              </div>
            </div>
          </Card>

          {/* Card 5: Retakes */}
          <Card className="shadow-card relative overflow-hidden">
            <div className="p-4.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Retakes</span>
                <div className="bg-purple-500/10 text-purple-600 dark:text-purple-400 flex size-8 items-center justify-center rounded-lg">
                  <RotateCcwIcon className="size-4" />
                </div>
              </div>
              <div className="mt-2.5">
                <p className="text-2xl font-bold tracking-tight tabular-nums">
                  <AnimatedCounter value={retakesTotal} />
                </p>
                <p className="text-muted-foreground mt-1 text-[11px]">Approved re-examinations</p>
              </div>
            </div>
          </Card>

          {/* Card 6: Retake Rate */}
          <Card className="shadow-card relative overflow-hidden">
            <div className="p-4.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Retake Rate</span>
                <div className="bg-rose-500/10 text-rose-600 dark:text-rose-400 flex size-8 items-center justify-center rounded-lg">
                  <PercentIcon className="size-4" />
                </div>
              </div>
              <div className="mt-2.5">
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold tracking-tight tabular-nums">
                    <AnimatedCounter value={retakeRate} />
                  </p>
                  <span className="text-muted-foreground text-sm font-semibold">%</span>
                </div>
                <p className="text-muted-foreground mt-1 text-[11px]">Of all submissions</p>
              </div>
            </div>
          </Card>
        </div>

        {/* ─── Wallet & Token Fuel Banner ─── */}
        <Card className="shadow-card bg-card/60 relative overflow-hidden border">
          <div className="p-5">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-4">
                <div className="bg-brand/10 text-brand flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <CoinsIcon className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">AI Generation Fuel &amp; Token Balance</h3>
                    <Badge variant="outline" className="text-[10px]">
                      Pay-as-you-go
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Current balance:{" "}
                    <span className="font-semibold text-foreground">
                      {formatTokens(walletBalance)} tokens
                    </span>{" "}
                    (≈ {formatUsd(tokensToUsd(walletBalance))}) · Consumed:{" "}
                    <span className="font-medium text-foreground">
                      {formatTokens(tokensConsumed)} tokens
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden text-right text-xs sm:block">
                  <p className="text-muted-foreground font-medium">Est. Exam Capacity</p>
                  <p className="font-semibold text-foreground">
                    ~{estimatedGenerationsLeft} standard exams left
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs shadow-xs"
                  nativeButton={false}
                  render={<Link href="/admin/wallet" />}
                >
                  <WalletCardsIcon className="size-3.5" />
                  <span>Manage Wallet</span>
                  <ArrowRightIcon className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* ─── Interactive Charts Row ─── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Chart 1: 14-Day Activity Trend */}
          <ChartCard
            title="14-Day Submission Velocity"
            description="Daily student exam submissions and auto-graded assessments"
          >
            {attemptsByDay.length > 0 ? (
              <CategoryBars
                data={attemptsByDay}
                xKey="date"
                yKey="attempts"
                label="Submissions"
                height="h-60"
              />
            ) : (
              <div className="flex h-60 flex-col items-center justify-center gap-2 text-center">
                <BarChart3Icon className="text-muted-foreground/40 size-8" />
                <p className="text-muted-foreground text-xs">
                  Activity trend will chart here once students submit attempts.
                </p>
              </div>
            )}
          </ChartCard>

          {/* Chart 2: Subject Distribution */}
          <ChartCard
            title="Exams & Attempts by Subject"
            description="Volume distribution across active academic disciplines"
          >
            {bySubject.length > 0 ? (
              <CategoryBars
                data={bySubject}
                xKey="subject"
                yKey="attempts"
                label="Attempts"
                vertical
                height="h-60"
              />
            ) : (
              <div className="flex h-60 flex-col items-center justify-center gap-2 text-center">
                <BookOpenIcon className="text-muted-foreground/40 size-8" />
                <p className="text-muted-foreground text-xs">
                  Subject breakdown will populate as exams are generated and taken.
                </p>
              </div>
            )}
          </ChartCard>
        </div>

        {/* ─── Retakes & Improvement Velocity (if any) ─── */}
        {retakesByExam.length > 0 && (
          <Card className="shadow-card overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="bg-purple-500/10 text-purple-600 dark:text-purple-400 flex size-8 items-center justify-center rounded-lg">
                    <TrendingUpIcon className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      Student Improvement on Retakes
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Approved re-examinations with verified score delta and unique retakers
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="secondary" className="font-mono text-xs">
                  {retakesByExam.length} active exam{retakesByExam.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
                {retakesByExam.slice(0, 4).map((r) => {
                  const subjectBadge = getSubjectBadge(r.subject);
                  return (
                    <Link
                      key={r.examId}
                      href={`/admin/exams/${r.examId}`}
                      className="group hover:bg-muted/30 flex flex-col justify-between p-4 transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${subjectBadge.bg} ${subjectBadge.text} ${subjectBadge.border}`}
                          >
                            {r.subject}
                          </span>
                          <span className="font-mono text-xs font-semibold tabular-nums">
                            {r.count} retake{r.count !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <h4 className="group-hover:text-primary mt-2 line-clamp-1 text-sm font-semibold text-foreground">
                          {r.title}
                        </h4>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {r.uniqueRetakers} unique student{r.uniqueRetakers !== 1 ? "s" : ""}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                        <span className="text-muted-foreground text-[11px]">Score Delta:</span>
                        {r.avgImprovement !== null ? (
                          <span
                            className={`flex items-center gap-0.5 text-xs font-bold ${
                              r.avgImprovement >= 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {r.avgImprovement >= 0 ? (
                              <ArrowUpIcon className="size-3" />
                            ) : (
                              <ArrowDownIcon className="size-3" />
                            )}
                            {r.avgImprovement >= 0 ? `+${r.avgImprovement}%` : `${r.avgImprovement}%`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs font-medium">—</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Detailed Assessment & Diagnostic Table (Core Showcase) ─── */}
        <Card className="shadow-card overflow-hidden">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold">
                    Detailed Assessment per Exam
                  </CardTitle>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {sortedExams.length} {sortedExams.length === 1 ? "exam" : "exams"}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Question-level failure &amp; skip analytics, cohort score distribution, and retake frequency.
                </CardDescription>
              </div>

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <Button
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={() => setViewMode("table")}
                  className="size-7"
                  title="Table View"
                >
                  <LayoutListIcon className="size-3.5" />
                </Button>
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={() => setViewMode("grid")}
                  className="size-7"
                  title="Grid View"
                >
                  <LayoutGridIcon className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* ─── Filter & Search Toolbar ─── */}
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {/* Search Box */}
              <div className="relative min-w-48 flex-1 sm:max-w-xs">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  placeholder="Search exam title, subject, ID…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 pl-8 text-xs"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear exam search"
                    onClick={() => setSearch("")}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Subject Filter Dropdown */}
              <Select
                value={subjectFilter}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setSubjectFilter(val);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectDisplay
                    value={subjectFilter}
                    placeholder="All Subjects"
                    options={[
                      { value: "all", label: "All Subjects" },
                      ...uniqueSubjects.map((sub) => ({ value: sub, label: sub })),
                    ]}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {uniqueSubjects.map((sub) => (
                    <SelectItem key={sub} value={sub}>
                      {sub}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Performance Score Filter Dropdown */}
              <Select
                value={scoreFilter}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setScoreFilter(val as ScoreFilter);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectDisplay
                    value={scoreFilter}
                    placeholder="All Performance"
                    options={SCORE_FILTER_OPTIONS}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Performance Levels</SelectItem>
                  <SelectItem value="high">High Scoring (≥ 70%)</SelectItem>
                  <SelectItem value="medium">Average (50% – 69%)</SelectItem>
                  <SelectItem value="low">Needs Attention (&lt; 50%)</SelectItem>
                  <SelectItem value="retakes">Has Retakes</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort Dropdown */}
              <Select
                value={sortField}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setSortField(val as SortField);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectDisplay value={sortField} placeholder="Sort By" options={SORT_FIELD_OPTIONS} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="totalAttempts">Sort by Total Attempts</SelectItem>
                  <SelectItem value="avgScore">Sort by Average Score</SelectItem>
                  <SelectItem value="retakeCount">Sort by Retakes Count</SelectItem>
                  <SelectItem value="maxFailRate">Sort by Question Fail Rate</SelectItem>
                  <SelectItem value="title">Sort by Exam Title</SelectItem>
                  <SelectItem value="gradedCount">Sort by Graded Count</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort Order Direction Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
                className="h-8 px-2 text-xs"
                title={`Currently sorted ${sortDir === "asc" ? "Ascending" : "Descending"}. Click to flip.`}
              >
                {sortDir === "asc" ? (
                  <ArrowUpIcon className="size-3.5 text-primary" />
                ) : (
                  <ArrowDownIcon className="size-3.5 text-primary" />
                )}
                <span className="hidden sm:inline">{sortDir === "asc" ? "Asc" : "Desc"}</span>
              </Button>

              {/* Clear Filters Button */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="text-muted-foreground hover:text-foreground h-8 px-2 text-xs"
                >
                  <XIcon className="mr-1 size-3" /> Clear
                </Button>
              )}
            </div>
          </CardHeader>

          {/* ─── Table View Mode ─── */}
          {viewMode === "table" ? (
            <div className="overflow-x-auto">
              <Table className="text-xs sm:text-sm">
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    {/* Exam & Subject */}
                    <TableHead
                      className="min-w-56 cursor-pointer select-none"
                      onClick={() => handleSort("title")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Exam &amp; Subject</span>
                        {sortField === "title" ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5 text-primary" />
                          ) : (
                            <ChevronDownIcon className="size-3.5 text-primary" />
                          )
                        ) : (
                          <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                        )}
                      </div>
                    </TableHead>

                    {/* Attempts */}
                    <TableHead
                      className="w-24 cursor-pointer text-right select-none"
                      onClick={() => handleSort("totalAttempts")}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Attempts</span>
                        {sortField === "totalAttempts" ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5 text-primary" />
                          ) : (
                            <ChevronDownIcon className="size-3.5 text-primary" />
                          )
                        ) : (
                          <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                        )}
                      </div>
                    </TableHead>

                    {/* Avg Score */}
                    <TableHead
                      className="w-32 cursor-pointer text-right select-none"
                      onClick={() => handleSort("avgScore")}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Avg Score</span>
                        {sortField === "avgScore" ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5 text-primary" />
                          ) : (
                            <ChevronDownIcon className="size-3.5 text-primary" />
                          )
                        ) : (
                          <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                        )}
                      </div>
                    </TableHead>

                    {/* Retakes */}
                    <TableHead
                      className="w-24 cursor-pointer text-right select-none"
                      onClick={() => handleSort("retakeCount")}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Retakes</span>
                        {sortField === "retakeCount" ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5 text-primary" />
                          ) : (
                            <ChevronDownIcon className="size-3.5 text-primary" />
                          )
                        ) : (
                          <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                        )}
                      </div>
                    </TableHead>

                    {/* Top Tricky Questions */}
                    <TableHead
                      className="min-w-72 cursor-pointer select-none"
                      onClick={() => handleSort("maxFailRate")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Top Tricky Questions</span>
                        {sortField === "maxFailRate" ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5 text-primary" />
                          ) : (
                            <ChevronDownIcon className="size-3.5 text-primary" />
                          )
                        ) : (
                          <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                        )}
                      </div>
                    </TableHead>

                    {/* Actions */}
                    <TableHead className="w-20 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {paginatedExams.map((e) => {
                    const isExpanded = expandedExamId === e.examId;
                    const subjectBadge = getSubjectBadge(e.subject);
                    const scoreBadge = getScoreBadge(e.avgScore);

                    return (
                      <Fragment key={e.examId}>
                        <TableRow
                          className="hover:bg-muted/40 transition-colors"
                        >
                          {/* Exam Title & Subject */}
                          <TableCell className="py-3.5">
                            <div className="flex flex-col gap-1">
                              <Link
                                href={`/admin/exams/${e.examId}`}
                                className="hover:text-primary font-semibold text-foreground underline-offset-4 hover:underline"
                              >
                                {e.title}
                              </Link>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${subjectBadge.bg} ${subjectBadge.text} ${subjectBadge.border}`}
                                >
                                  {e.subject}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  {e.gradedCount} graded submission{e.gradedCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Total Attempts */}
                          <TableCell className="text-right font-mono font-medium tabular-nums">
                            {e.totalAttempts}
                          </TableCell>

                          {/* Average Score */}
                          <TableCell className="text-right">
                            {e.avgScore !== null ? (
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${scoreBadge.color}`}
                                >
                                  {e.avgScore}%
                                </span>
                                <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                                  <div
                                    className={`h-full ${scoreBadge.bar}`}
                                    style={{ width: `${Math.min(100, e.avgScore)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>

                          {/* Retakes */}
                          <TableCell className="text-right font-mono font-medium tabular-nums">
                            {e.retakeCount > 0 ? (
                              <Badge variant="secondary" className="font-mono text-xs">
                                {e.retakeCount}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">0</span>
                            )}
                          </TableCell>

                          {/* Top Failed Questions Preview */}
                          <TableCell>
                            <div className="flex flex-col gap-1.5">
                              {e.failedQuestionRates.slice(0, 2).map((q) => (
                                <div
                                  key={q.questionId}
                                  className="bg-muted/40 flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                                >
                                  <span className="truncate max-w-56 font-medium text-foreground">
                                    {q.prompt}
                                  </span>
                                  <span className="text-amber-600 dark:text-amber-400 shrink-0 font-mono font-semibold">
                                    {q.failRate}% fail · {q.skippedRate}% skip
                                  </span>
                                </div>
                              ))}
                              {e.failedQuestionRates.length === 0 && (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                              {e.failedQuestionRates.length > 2 && (
                                <button
                                  onClick={() => toggleRowExpand(e.examId)}
                                  className="text-primary hover:underline self-start text-[11px] font-medium"
                                >
                                  {isExpanded
                                    ? "Hide breakdown"
                                    : `+ ${e.failedQuestionRates.length - 2} more tricky questions`}
                                </button>
                              )}
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => toggleRowExpand(e.examId)}
                                className="size-7"
                                title={isExpanded ? "Collapse Details" : "Expand Question Diagnostics"}
                              >
                                {isExpanded ? (
                                  <ChevronUpIcon className="size-3.5" />
                                ) : (
                                  <ChevronDownIcon className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="icon-xs"
                                className="size-7"
                                nativeButton={false}
                                render={<Link href={`/admin/exams/${e.examId}`} />}
                                title="Open Exam"
                              >
                                <EyeIcon className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* ─── Expandable Diagnostic Drawer ─── */}
                        {isExpanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={6} className="p-4 sm:p-5">
                              <div className="rounded-xl border bg-card p-4 shadow-xs">
                                <div className="flex items-center justify-between gap-3 border-b pb-3">
                                  <div className="flex items-center gap-2">
                                    <HelpCircleIcon className="text-primary size-4" />
                                    <h4 className="text-sm font-semibold">
                                      Comprehensive Question Diagnostic Breakdown
                                    </h4>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    nativeButton={false}
                                    render={<Link href={`/admin/exams/${e.examId}`} />}
                                  >
                                    View Full Exam Questions
                                    <ArrowRightIcon className="ml-1 size-3" />
                                  </Button>
                                </div>

                                <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                  {e.failedQuestionRates.map((q, idx) => (
                                    <div
                                      key={q.questionId}
                                      className="rounded-lg border bg-muted/30 p-3 text-xs"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-semibold text-foreground">
                                          Question {idx + 1}
                                        </span>
                                        <span
                                          className={`font-mono font-bold ${
                                            q.failRate >= 50
                                              ? "text-rose-600 dark:text-rose-400"
                                              : q.failRate >= 25
                                                ? "text-amber-600 dark:text-amber-400"
                                                : "text-emerald-600 dark:text-emerald-400"
                                          }`}
                                        >
                                          {q.failRate}% Failed
                                        </span>
                                      </div>
                                      <p className="text-muted-foreground mt-1.5 line-clamp-2">
                                        {q.prompt}
                                      </p>
                                      <div className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                                        <span>Skipped by students:</span>
                                        <span className="font-mono font-medium text-foreground">
                                          {q.skippedRate}%
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}

                  {/* Empty State */}
                  {paginatedExams.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-2">
                          <div className="bg-muted/50 flex size-12 items-center justify-center rounded-2xl">
                            <FileSpreadsheetIcon className="text-muted-foreground size-6" />
                          </div>
                          <p className="font-semibold text-foreground">No matching exams found</p>
                          <p className="text-muted-foreground text-xs">
                            {hasActiveFilters
                              ? "No exams match your current filter and search query. Try resetting your search terms."
                              : "Generate exams to see in-depth assessment and student failure rate telemetry."}
                          </p>
                          {hasActiveFilters && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleClearFilters}
                              className="mt-2 text-xs"
                            >
                              Reset active filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            /* ─── Grid View Mode ─── */
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedExams.map((e) => {
                const subjectBadge = getSubjectBadge(e.subject);
                const scoreBadge = getScoreBadge(e.avgScore);

                return (
                  <Card
                    key={e.examId}
                    className="shadow-card hover:border-primary/40 relative flex flex-col justify-between overflow-hidden transition-all"
                  >
                    <div className="p-4.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${subjectBadge.bg} ${subjectBadge.text} ${subjectBadge.border}`}
                        >
                          {e.subject}
                        </span>
                        {e.avgScore !== null && (
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${scoreBadge.color}`}
                          >
                            {e.avgScore}% Avg
                          </span>
                        )}
                      </div>

                      <h4 className="mt-2.5 line-clamp-1 font-bold text-foreground">
                        <Link href={`/admin/exams/${e.examId}`} className="hover:underline">
                          {e.title}
                        </Link>
                      </h4>

                      <div className="mt-3 grid grid-cols-2 gap-2 border-y py-2.5 text-xs">
                        <div>
                          <p className="text-muted-foreground text-[11px]">Total Attempts</p>
                          <p className="font-semibold tabular-nums">{e.totalAttempts}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[11px]">Retakes</p>
                          <p className="font-semibold tabular-nums">{e.retakeCount}</p>
                        </div>
                      </div>

                      {/* Tricky Questions */}
                      <div className="mt-3">
                        <p className="text-muted-foreground text-[11px] font-medium">Top Tricky Question:</p>
                        {e.failedQuestionRates[0] ? (
                          <p className="mt-1 line-clamp-1 text-xs font-medium text-foreground">
                            {e.failedQuestionRates[0].prompt}
                          </p>
                        ) : (
                          <p className="text-muted-foreground text-xs">—</p>
                        )}
                      </div>
                    </div>

                    <CardFooter className="border-t bg-muted/20 py-2.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-between text-xs"
                        nativeButton={false}
                        render={<Link href={`/admin/exams/${e.examId}`} />}
                      >
                        <span>View Exam Details</span>
                        <ArrowRightIcon className="size-3.5" />
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}

              {paginatedExams.length === 0 && (
                <div className="col-span-full py-12 text-center">
                  <p className="font-semibold">No matching exams found</p>
                  <p className="text-muted-foreground text-xs">Try adjusting your active filters.</p>
                </div>
              )}
            </div>
          )}

          {/* ─── Pagination Bar ─── */}
          {sortedExams.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
              {/* Page Size Selector */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Show</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v: string | null) => {
                    if (v) {
                      setPageSize(Number(v));
                      setPage(1);
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-16 text-xs">
                    <SelectDisplay
                      value={String(pageSize)}
                      options={[5, 10, 20, 50].map((n) => ({ value: String(n), label: String(n) }))}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
                <span>per page</span>
              </div>

              {/* Entries Counter */}
              <p className="text-muted-foreground text-xs">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {Math.min(startIndex + 1, sortedExams.length)}
                </span>{" "}
                to{" "}
                <span className="font-medium text-foreground">
                  {Math.min(startIndex + pageSize, sortedExams.length)}
                </span>{" "}
                of <span className="font-medium text-foreground">{sortedExams.length}</span> exams
              </p>

              {/* Page Buttons */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => setPage(1)}
                  disabled={currentPage <= 1}
                  title="First Page"
                  className="size-7"
                >
                  <ChevronsLeftIcon className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  title="Previous Page"
                  className="size-7"
                >
                  <ChevronLeftIcon className="size-3.5" />
                </Button>

                {/* Page Number Chips */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5) {
                    if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="icon-xs"
                      onClick={() => setPage(pageNum)}
                      className="size-7 font-mono text-xs"
                    >
                      {pageNum}
                    </Button>
                  );
                })}

                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  title="Next Page"
                  className="size-7"
                >
                  <ChevronRightIcon className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  title="Last Page"
                  className="size-7"
                >
                  <ChevronsRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}
