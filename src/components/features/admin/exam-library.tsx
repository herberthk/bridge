"use client";

import { useMemo, useState, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowDownNarrowWideIcon,
  ArrowUpIcon,
  ArrowUpNarrowWideIcon,
  ArrowUpDownIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileStackIcon,
  FileTextIcon,
  FilterIcon,
  GraduationCapIcon,
  HistoryIcon,
  LayoutGridIcon,
  LayoutListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { AssignExamDialog } from "@/components/features/admin/assign-exam-dialog";
import { reviewProgress } from "@/lib/exam/review";
import {
  SUBJECT_LABELS,
  DIFFICULTY_LABELS,
  type ExamStatus,
  type Subject,
  type Difficulty,
} from "@/lib/constants";
import type { ExamDoc, UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortField =
  | "createdAt"
  | "updatedAt"
  | "title"
  | "questions"
  | "duration"
  | "retakes"
  | "status";

type SortDirection = "asc" | "desc";
type ViewMode = "table" | "grid";
type StatusFilter = "all" | "draft" | "needs_review" | "active" | "scheduled" | "archived";
type LevelFilter = "all" | "primary" | "secondary" | "o_level" | "a_level";

const STATUS_CONFIG: Record<
  ExamStatus,
  { label: string; variant: "default" | "secondary" | "outline"; badgeClass: string; dotClass: string }
> = {
  draft: {
    label: "Draft",
    variant: "outline",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-500",
  },
  scheduled: {
    label: "Scheduled",
    variant: "default",
    badgeClass: "border-primary/30 bg-primary/10 text-primary",
    dotClass: "bg-primary",
  },
  active: {
    label: "Active",
    variant: "secondary",
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-500 animate-pulse",
  },
  archived: {
    label: "Archived",
    variant: "outline",
    badgeClass: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};

const DIFFICULTY_CONFIG: Record<Difficulty, { label: string; className: string }> = {
  easy: {
    label: "Easy",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  medium: {
    label: "Medium",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  hard: {
    label: "Hard",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  very_hard: {
    label: "Very Hard",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
};

interface ProcessedExam {
  raw: SerializedWithId<ExamDoc>;
  id: string;
  title: string;
  topic: string;
  subject: Subject;
  subjectLabel: string;
  level: string;
  secondarySubLevel: string | null;
  classLevel: number;
  classFormatted: string;
  difficulty: Difficulty;
  durationMinutes: number;
  questionCount: number;
  sourceType: "params" | "documents";
  status: ExamStatus;
  retakesCount: number;
  createdDate: Date | null;
  createdMillis: number;
  createdFormatted: string;
  createdTime: string;
  updatedDate: Date | null;
  updatedMillis: number;
  updatedFormatted: string;
  updatedTime: string;
  needsReview: boolean;
  reviewProgress: { approved: number; total: number; complete: boolean };
  searchIndex: string;
}

export function ExamLibrary({
  exams,
  students,
  retakeCounts = {},
}: {
  exams: SerializedWithId<ExamDoc>[];
  students: SerializedWithId<UserDoc>[];
  retakeCounts?: Record<string, number>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // Performance-optimized preprocessing of exams
  const processedExams = useMemo<ProcessedExam[]>(() => {
    return exams.map((e) => {
      const createdDate = parseDate(e.createdAt) ?? parseDate(e.updatedAt) ?? parseDate(e.review?.approvedAt) ?? null;
      const updatedDate = parseDate(e.updatedAt) ?? parseDate(e.review?.updatedAt) ?? createdDate;
      const createdMillis = createdDate ? createdDate.getTime() : 0;
      const updatedMillis = updatedDate ? updatedDate.getTime() : createdMillis;

      const progress = reviewProgress(e.questions, e.review);
      const needsReview = e.status === "draft" && !progress.complete;
      const subject = e.params.subject as Subject;
      const subjectLabel = SUBJECT_LABELS[subject] ?? subject;

      const classFormatted =
        e.params.level === "primary"
          ? `Primary P${e.params.classLevel}`
          : `Secondary S${e.params.classLevel}${e.params.secondarySubLevel === "a_level" ? " · A-Level" : " · O-Level"}`;

      const createdFormatted = createdDate ? format(createdDate, "d MMM yyyy") : "—";
      const createdTime = createdDate ? format(createdDate, "HH:mm") : "";
      const updatedFormatted = updatedDate ? format(updatedDate, "d MMM yyyy") : "—";
      const updatedTime = updatedDate ? format(updatedDate, "HH:mm") : "";

      const retakesCount = retakeCounts[e.id] ?? 0;

      const searchIndex = [
        e.title,
        e.params.topic,
        subjectLabel,
        subject,
        classFormatted,
        `P${e.params.classLevel}`,
        `S${e.params.classLevel}`,
        e.params.difficulty,
        e.status,
      ]
        .join(" ")
        .toLowerCase();

      return {
        raw: e,
        id: e.id,
        title: e.title,
        topic: e.params.topic,
        subject,
        subjectLabel,
        level: e.params.level,
        secondarySubLevel: e.params.secondarySubLevel ?? null,
        classLevel: e.params.classLevel,
        classFormatted,
        difficulty: e.params.difficulty,
        durationMinutes: e.params.durationMinutes,
        questionCount: e.questions.length,
        sourceType: e.sourceType ?? "params",
        status: e.status,
        retakesCount,
        createdDate,
        createdMillis,
        createdFormatted,
        createdTime,
        updatedDate,
        updatedMillis,
        updatedFormatted,
        updatedTime,
        needsReview,
        reviewProgress: progress,
        searchIndex,
      };
    });
  }, [exams, retakeCounts]);

  // Distinct subjects available in the dataset for filter dropdown
  const availableSubjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of processedExams) {
      if (!map.has(e.subject)) {
        map.set(e.subject, e.subjectLabel);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [processedExams]);

  // Overall KPI statistics
  const stats = useMemo(() => {
    let activeOrScheduled = 0;
    let draftsNeedingReview = 0;
    let totalRetakes = 0;
    let primaryCount = 0;
    let secondaryCount = 0;

    for (const e of processedExams) {
      if (e.status === "active" || e.status === "scheduled") activeOrScheduled++;
      if (e.needsReview) draftsNeedingReview++;
      totalRetakes += e.retakesCount;
      if (e.level === "primary") primaryCount++;
      else secondaryCount++;
    }

    return {
      total: processedExams.length,
      activeOrScheduled,
      draftsNeedingReview,
      totalRetakes,
      primaryCount,
      secondaryCount,
    };
  }, [processedExams]);

  // Filtered & Sorted exams
  const filteredAndSortedExams = useMemo(() => {
    let result = processedExams;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.searchIndex.includes(query));
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "needs_review") {
        result = result.filter((e) => e.needsReview);
      } else {
        result = result.filter((e) => e.status === statusFilter);
      }
    }

    // Subject filter
    if (subjectFilter !== "all") {
      result = result.filter((e) => e.subject === subjectFilter);
    }

    // Level filter
    if (levelFilter !== "all") {
      if (levelFilter === "primary") {
        result = result.filter((e) => e.level === "primary");
      } else if (levelFilter === "secondary") {
        result = result.filter((e) => e.level === "secondary");
      } else if (levelFilter === "o_level") {
        result = result.filter((e) => e.level === "secondary" && e.secondarySubLevel !== "a_level");
      } else if (levelFilter === "a_level") {
        result = result.filter((e) => e.level === "secondary" && e.secondarySubLevel === "a_level");
      }
    }

    // Sorting
    const mult = sortDirection === "asc" ? 1 : -1;
    return [...result].sort((a, b) => {
      switch (sortField) {
        case "createdAt":
          return (a.createdMillis - b.createdMillis) * mult;
        case "updatedAt":
          return (a.updatedMillis - b.updatedMillis) * mult;
        case "title":
          return a.title.localeCompare(b.title) * mult;
        case "questions":
          return (a.questionCount - b.questionCount) * mult;
        case "duration":
          return (a.durationMinutes - b.durationMinutes) * mult;
        case "retakes":
          return (a.retakesCount - b.retakesCount) * mult;
        case "status":
          return a.status.localeCompare(b.status) * mult;
        default:
          return 0;
      }
    });
  }, [processedExams, searchQuery, statusFilter, subjectFilter, levelFilter, sortField, sortDirection]);

  // Pagination calculation
  const totalItems = filteredAndSortedExams.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedExams = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredAndSortedExams.slice(start, start + pageSize);
  }, [filteredAndSortedExams, safeCurrentPage, pageSize]);

  // Handlers
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection(field === "title" ? "asc" : "desc");
      }
    },
    [sortField]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      startTransition(() => {
        setSearchQuery(val);
        setCurrentPage(1);
      });
    },
    []
  );

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
    setSubjectFilter("all");
    setLevelFilter("all");
    setSortField("createdAt");
    setSortDirection("desc");
    setCurrentPage(1);
  }, []);

  const copyExamId = useCallback(async (id: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard access is unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      toast.success("Exam ID copied to clipboard");
    } catch {
      toast.error("Could not copy the Exam ID");
    }
  }, []);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    subjectFilter !== "all" ||
    levelFilter !== "all";

  // Page Numbers Generator for Pagination
  const pageNumbers = useMemo(() => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) pages.push("ellipsis");

      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);

      for (let i = start; i <= end; i++) pages.push(i);

      if (safeCurrentPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safeCurrentPage]);

  return (
    <TooltipProvider delay={200}>
      <div className="flex flex-col gap-6">
        {/* Header with Title & CTA */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Exam Library
              </h1>
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary text-xs font-semibold">
                {stats.total} Total
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage, review, filter, and assign curriculum-aligned AI exams across your school.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              className="shadow-glow transition-all hover:scale-[1.02] active:scale-[0.98]"
              nativeButton={false}
              render={<Link href="/admin/generate" />}
            >
              <SparklesIcon data-icon="inline-start" className="size-4 text-amber-300" />
              Generate Exam
            </Button>
          </div>
        </div>

        {/* Overview KPI Cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="shadow-card relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Total Exams
              </span>
              <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                <FileStackIcon className="size-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{stats.total}</span>
              <span className="text-muted-foreground text-xs">
                {stats.primaryCount} Prim · {stats.secondaryCount} Sec
              </span>
            </div>
          </div>

          <div className="shadow-card relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all hover:border-emerald-500/30">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Active & Scheduled
              </span>
              <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex size-8 items-center justify-center rounded-lg">
                <CheckCircle2Icon className="size-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {stats.activeOrScheduled}
              </span>
              <span className="text-muted-foreground text-xs">Assigned to students</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStatusFilter(stats.draftsNeedingReview > 0 ? "needs_review" : "draft")}
            className={`shadow-card relative cursor-pointer overflow-hidden rounded-xl border p-4 text-left transition-all hover:scale-[1.01] ${
              stats.draftsNeedingReview > 0
                ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                : "border-border/80 bg-card hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Awaiting Review
              </span>
              <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-8 items-center justify-center rounded-lg">
                <AlertCircleIcon className="size-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-400">
                {stats.draftsNeedingReview}
              </span>
              <span className="text-xs text-amber-600/80 dark:text-amber-400/80">
                {stats.draftsNeedingReview === 1 ? "Draft requires approval" : "Drafts require approval"}
              </span>
            </div>
          </button>

          <div className="shadow-card relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all hover:border-purple-500/30">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Total Retakes
              </span>
              <div className="bg-purple-500/10 text-purple-600 dark:text-purple-400 flex size-8 items-center justify-center rounded-lg">
                <RotateCcwIcon className="size-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{stats.totalRetakes}</span>
              <span className="text-muted-foreground text-xs">Student retake sessions</span>
            </div>
          </div>
        </div>

        {/* Search, Filters, Sorters & View Controls Toolbar */}
        <div className="shadow-card flex flex-col gap-3.5 rounded-xl border border-border/80 bg-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 min-w-60">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search exams by title, topic, subject, or class (e.g. 'P4 Science')..."
                className="pl-9 pr-8 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5"
                >
                  <XIcon className="size-3.5" />
                  <span className="sr-only">Clear search</span>
                </button>
              )}
            </div>

            {/* Quick Filter Selects */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <div className="w-35 sm:w-37.5">
                <Select
                  value={statusFilter}
                  onValueChange={(val) => {
                    setStatusFilter(val as StatusFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Subject Filter */}
              <div className="w-[140px] sm:w-[160px]">
                <Select
                  value={subjectFilter}
                  onValueChange={(val) => {
                    //@ts-expect-error it will be fixed later
                    setSubjectFilter(val);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {availableSubjects.map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Level Filter */}
              <div className="w-32.5 sm:w-36.25">
                <Select
                  value={levelFilter}
                  onValueChange={(val) => {
                    setLevelFilter(val as LevelFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="primary">Primary (P1–P7)</SelectItem>
                    <SelectItem value="secondary">Secondary (All)</SelectItem>
                    <SelectItem value="o_level">O-Level (S1–S4)</SelectItem>
                    <SelectItem value="a_level">A-Level (S5–S6)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort By Select */}
              <div className="w-35 sm:w-38.75">
                <Select
                  value={sortField}
                  onValueChange={(val) => {
                    setSortField(val as SortField);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="createdAt">Created Date</SelectItem>
                    <SelectItem value="updatedAt">Updated Date</SelectItem>
                    <SelectItem value="title">Exam Title</SelectItem>
                    <SelectItem value="questions">Questions Count</SelectItem>
                    <SelectItem value="duration">Duration</SelectItem>
                    <SelectItem value="retakes">Retakes</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort Direction Toggle Button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
                      className="px-2"
                      aria-label="Toggle sort direction"
                    />
                  }
                >
                  {sortDirection === "desc" ? (
                    <ArrowDownNarrowWideIcon className="size-4 text-primary" />
                  ) : (
                    <ArrowUpNarrowWideIcon className="size-4 text-primary" />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {sortDirection === "desc" ? "Descending (Newest / Highest First)" : "Ascending (Oldest / Lowest First)"}
                </TooltipContent>
              </Tooltip>

              {/* View Mode Toggle */}
              <div className="border-border/60 bg-muted/30 ml-auto flex items-center rounded-lg border p-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={viewMode === "table" ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={() => setViewMode("table")}
                        className="rounded-md"
                      />
                    }
                  >
                    <LayoutListIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>Table View</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={viewMode === "grid" ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={() => setViewMode("grid")}
                        className="rounded-md"
                      />
                    }
                  >
                    <LayoutGridIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>Grid Cards View</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Active Filter Badges */}
          {hasActiveFilters && (
            <div className="border-border/60 flex flex-wrap items-center gap-1.5 border-t pt-2.5 text-xs">
              <span className="text-muted-foreground font-medium">Filters active:</span>

              {searchQuery && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <span>Search: &quot;{searchQuery}&quot;</span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                    <span className="sr-only">Clear search filter</span>
                  </button>
                </Badge>
              )}

              {statusFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <span>Status: {statusFilter.replace("_", " ")}</span>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                    <span className="sr-only">Clear status filter</span>
                  </button>
                </Badge>
              )}

              {subjectFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <span>Subject: {SUBJECT_LABELS[subjectFilter as Subject] ?? subjectFilter}</span>
                  <button
                    type="button"
                    onClick={() => setSubjectFilter("all")}
                    className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                    <span className="sr-only">Clear subject filter</span>
                  </button>
                </Badge>
              )}

              {levelFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <span>Level: {levelFilter.replace("_", " ")}</span>
                  <button
                    type="button"
                    onClick={() => setLevelFilter("all")}
                    className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                    <span className="sr-only">Clear level filter</span>
                  </button>
                </Badge>
              )}

              <Button
                variant="ghost"
                size="xs"
                onClick={handleResetFilters}
                className="text-muted-foreground hover:text-foreground text-xs ml-1"
              >
                Clear all filters
              </Button>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        {processedExams.length === 0 ? (
          /* Zero Exams in Database */
          <div className="shadow-card flex flex-col items-center justify-center gap-4 rounded-xl border border-border/80 bg-card p-14 text-center">
            <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
              <FileStackIcon className="size-7" />
            </div>
            <div className="max-w-md">
              <h3 className="text-lg font-semibold tracking-tight">No exams created yet</h3>
              <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
                Generate your first AI-crafted exam aligned with UNEB curricula in under 30 seconds.
              </p>
            </div>
            <Button
              className="shadow-glow mt-2"
              onClick={() => router.push("/admin/generate")}
            >
              <SparklesIcon data-icon="inline-start" className="size-4 text-amber-300" />
              Generate your first exam
            </Button>
          </div>
        ) : filteredAndSortedExams.length === 0 ? (
          /* Filter Returned No Results */
          <div className="shadow-card flex flex-col items-center justify-center gap-3 rounded-xl border border-border/80 bg-card p-12 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
              <SearchIcon className="size-6" />
            </div>
            <h3 className="text-base font-semibold">No matching exams found</h3>
            <p className="text-muted-foreground max-w-sm text-sm">
              We couldn&apos;t find any exams matching your search filters. Try broadening your keywords or clearing filters.
            </p>
            <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-2">
              Clear all filters
            </Button>
          </div>
        ) : viewMode === "table" ? (
          /* Table View */
          <div className="shadow-card overflow-hidden rounded-xl border border-border/80 bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead
                      className="cursor-pointer select-none py-3 font-semibold transition-colors hover:text-foreground"
                      onClick={() => handleSort("title")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Exam & Topic</span>
                        {sortField === "title" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="font-semibold">Subject & Level</TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground"
                      onClick={() => handleSort("questions")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Questions</span>
                        {sortField === "questions" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground"
                      onClick={() => handleSort("duration")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Duration</span>
                        {sortField === "duration" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground"
                      onClick={() => handleSort("retakes")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Retakes</span>
                        {sortField === "retakes" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground"
                      onClick={() => handleSort("status")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        {sortField === "status" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground min-w-[125px]"
                      onClick={() => handleSort("createdAt")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Created At</span>
                        {sortField === "createdAt" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer select-none font-semibold transition-colors hover:text-foreground min-w-[125px]"
                      onClick={() => handleSort("updatedAt")}
                    >
                      <div className="flex items-center gap-1">
                        <span>Updated At</span>
                        {sortField === "updatedAt" && (
                          sortDirection === "asc" ? <ArrowUpIcon className="size-3.5 text-primary" /> : <ArrowDownIcon className="size-3.5 text-primary" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="w-36 text-right font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {paginatedExams.map((e) => {
                    const statusInfo = STATUS_CONFIG[e.status] ?? STATUS_CONFIG.draft;
                    const diffInfo = DIFFICULTY_CONFIG[e.difficulty] ?? DIFFICULTY_CONFIG.medium;

                    return (
                      <TableRow key={e.id} className="group transition-colors hover:bg-muted/30">
                        {/* Exam Title & Topic */}
                        <TableCell className="max-w-[280px] py-3.5">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/admin/exams/${e.id}`}
                                className="truncate font-semibold text-foreground transition-colors hover:text-primary hover:underline"
                              >
                                {e.title}
                              </Link>
                              {e.sourceType === "documents" && (
                                <Tooltip>
                                  <TooltipTrigger render={<span />}>
                                    <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent>Grounded on uploaded documents</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <span className="text-muted-foreground truncate text-xs">
                              {e.topic || "General topic"}
                            </span>
                            <div className="flex items-center gap-1 pt-0.5">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${diffInfo.className}`}>
                                {diffInfo.label}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>

                        {/* Subject & Level */}
                        <TableCell className="py-3.5">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-xs text-foreground">
                              {e.subjectLabel}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {e.classFormatted}
                            </span>
                          </div>
                        </TableCell>

                        {/* Questions */}
                        <TableCell className="py-3.5 tabular-nums text-sm font-medium">
                          {e.questionCount} Qs
                        </TableCell>

                        {/* Duration */}
                        <TableCell className="py-3.5 tabular-nums text-sm font-medium">
                          {e.durationMinutes} min
                        </TableCell>

                        {/* Retakes */}
                        <TableCell className="py-3.5">
                          {e.retakesCount > 0 ? (
                            <Badge variant="secondary" className="tabular-nums text-xs font-semibold">
                              <RotateCcwIcon className="size-3 mr-1 text-purple-600 dark:text-purple-400" />
                              {e.retakesCount} {e.retakesCount === 1 ? "retake" : "retakes"}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>

                        {/* Status & Review */}
                        <TableCell className="py-3.5">
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`size-2 rounded-full ${statusInfo.dotClass}`} />
                              <Badge variant="outline" className={`text-xs ${statusInfo.badgeClass}`}>
                                {statusInfo.label}
                              </Badge>
                            </div>
                            {e.needsReview && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 bg-amber-500/10 text-[10px] tabular-nums text-amber-700 dark:text-amber-400"
                              >
                                {e.reviewProgress.approved}/{e.reviewProgress.total} reviewed
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Created At */}
                        <TableCell className="py-3.5 text-xs">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{e.createdFormatted}</span>
                            {e.createdTime && (
                              <span className="text-muted-foreground text-[11px]">{e.createdTime}</span>
                            )}
                          </div>
                        </TableCell>

                        {/* Updated At */}
                        <TableCell className="py-3.5 text-xs">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{e.updatedFormatted}</span>
                            {e.updatedTime && (
                              <span className="text-muted-foreground text-[11px]">{e.updatedTime}</span>
                            )}
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {e.status === "draft" && (
                              <Button
                                size="xs"
                                variant={e.needsReview ? "default" : "outline"}
                                render={<Link href={`/admin/exams/${e.id}/review`} />}
                                className={e.needsReview ? "shadow-xs" : ""}
                              >
                                <ClipboardCheckIcon data-icon="inline-start" className="size-3.5" />
                                Review
                              </Button>
                            )}

                            {e.status !== "archived" && (
                              <AssignExamDialog exam={e.raw} students={students} size="sm" />
                            )}

                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" />
                                }
                              >
                                <MoreHorizontalIcon className="size-4" />
                                <span className="sr-only">Open options</span>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Exam Options</DropdownMenuLabel>
                                <DropdownMenuItem render={<Link href={`/admin/exams/${e.id}`} />}>
                                  <EyeIcon data-icon="inline-start" className="size-4" />
                                  View Details & Attempts
                                </DropdownMenuItem>
                                <DropdownMenuItem render={<Link href={`/admin/exams/${e.id}/review`} />}>
                                  <ClipboardCheckIcon data-icon="inline-start" className="size-4" />
                                  Review Questions
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => void copyExamId(e.id)}>
                                  <CopyIcon data-icon="inline-start" className="size-4" />
                                  Copy Exam ID
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          /* Card / Grid View */
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedExams.map((e) => {
              const statusInfo = STATUS_CONFIG[e.status] ?? STATUS_CONFIG.draft;
              const diffInfo = DIFFICULTY_CONFIG[e.difficulty] ?? DIFFICULTY_CONFIG.medium;

              return (
                <div
                  key={e.id}
                  className="shadow-card group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-5 transition-all hover:border-primary/40 hover:shadow-lifted"
                >
                  <div className="flex flex-col gap-3">
                    {/* Top Badges */}
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary text-xs font-semibold">
                        {e.subjectLabel}
                      </Badge>
                      <div className="flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${statusInfo.dotClass}`} />
                        <Badge variant="outline" className={`text-xs ${statusInfo.badgeClass}`}>
                          {statusInfo.label}
                        </Badge>
                      </div>
                    </div>

                    {/* Title and Topic */}
                    <div>
                      <Link
                        href={`/admin/exams/${e.id}`}
                        className="line-clamp-2 text-base font-bold tracking-tight text-foreground transition-colors hover:text-primary hover:underline"
                      >
                        {e.title}
                      </Link>
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {e.topic || "General topic assessment"}
                      </p>
                    </div>

                    {/* Meta Specs Chips */}
                    <div className="border-border/60 flex flex-wrap items-center gap-2 border-y py-2.5 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <GraduationCapIcon className="size-3.5 text-foreground/70" />
                        <span className="font-medium text-foreground">{e.classFormatted}</span>
                      </div>
                      <span className="text-border">•</span>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <FileTextIcon className="size-3.5 text-foreground/70" />
                        <span>{e.questionCount} Questions</span>
                      </div>
                      <span className="text-border">•</span>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <ClockIcon className="size-3.5 text-foreground/70" />
                        <span>{e.durationMinutes}m</span>
                      </div>
                    </div>

                    {/* Review Gate or Retake notice */}
                    {e.needsReview ? (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold flex items-center gap-1">
                            <AlertCircleIcon className="size-3.5" />
                            Review Required
                          </span>
                          <span className="font-mono">
                            {e.reviewProgress.approved}/{e.reviewProgress.total}
                          </span>
                        </div>
                      </div>
                    ) : e.retakesCount > 0 ? (
                      <div className="flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-300">
                        <RotateCcwIcon className="size-3.5" />
                        <span className="font-medium">{e.retakesCount} student {e.retakesCount === 1 ? "retake" : "retakes"} recorded</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Footer Timestamps and Actions */}
                  <div className="mt-4 flex flex-col gap-3 pt-3 border-t border-border/60">
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/80">Created</span>
                        <span className="font-medium text-foreground">{e.createdFormatted} {e.createdTime}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/80">Updated</span>
                        <span className="font-medium text-foreground">{e.updatedFormatted} {e.updatedTime}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        render={<Link href={`/admin/exams/${e.id}`} />}
                        className="text-xs"
                      >
                        <EyeIcon data-icon="inline-start" className="size-3.5" />
                        Details
                      </Button>

                      <div className="flex items-center gap-1.5">
                        {e.status === "draft" && (
                          <Button
                            size="xs"
                            variant={e.needsReview ? "default" : "outline"}
                            render={<Link href={`/admin/exams/${e.id}/review`} />}
                          >
                            <ClipboardCheckIcon data-icon="inline-start" className="size-3.5" />
                            Review
                          </Button>
                        )}
                        {e.status !== "archived" && (
                          <AssignExamDialog exam={e.raw} students={students} size="sm" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        {filteredAndSortedExams.length > 0 && (
          <div className="shadow-card flex flex-col items-center justify-between gap-4 rounded-xl border border-border/80 bg-card px-4 py-3 sm:flex-row">
            {/* Range Text & Page Size Selector */}
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                Showing{" "}
                <strong className="font-semibold text-foreground">
                  {(safeCurrentPage - 1) * pageSize + 1}–{Math.min(safeCurrentPage * pageSize, totalItems)}
                </strong>{" "}
                of <strong className="font-semibold text-foreground">{totalItems}</strong> exams
                {totalItems !== processedExams.length && ` (filtered from ${processedExams.length})`}
              </span>

              <div className="flex items-center gap-1.5 pl-2 border-l border-border/60">
                <span className="text-xs">Per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-17.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Numeric & Navigation Buttons */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage(1)}
                      aria-label="First page"
                    />
                  }
                >
                  <ChevronsLeftIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>First Page</TooltipContent>
              </Tooltip>

              <Button
                variant="outline"
                size="xs"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="gap-1 px-2"
              >
                <ChevronLeftIcon className="size-3.5" />
                <span className="hidden sm:inline">Prev</span>
              </Button>

              {/* Page Number Pills */}
              <div className="flex items-center gap-1 mx-1">
                {pageNumbers.map((p, idx) => {
                  if (p === "ellipsis") {
                    return (
                      <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground">
                        …
                      </span>
                    );
                  }
                  const isCurrent = p === safeCurrentPage;
                  return (
                    <Button
                      key={p}
                      variant={isCurrent ? "default" : "outline"}
                      size="icon-xs"
                      onClick={() => setCurrentPage(p)}
                      className={`text-xs ${isCurrent ? "shadow-xs font-semibold" : ""}`}
                    >
                      {p}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="xs"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="gap-1 px-2"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon className="size-3.5" />
              </Button>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage(totalPages)}
                      aria-label="Last page"
                    />
                  }
                >
                  <ChevronsRightIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Last Page</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <p className="flex items-center gap-1.5">
            <CalendarClockIcon className="size-3.5 text-primary/70" />
            Scheduled exams unlock automatically for assigned students at their scheduled time.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
