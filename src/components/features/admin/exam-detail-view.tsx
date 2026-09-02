"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronUpIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LayersIcon,
  LightbulbIcon,
  RotateCcwIcon,
  SearchIcon,
  Share2Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";

import { AssignExamDialog } from "@/components/features/admin/assign-exam-dialog";
import { Markdown } from "@/components/markdown";
import { reviewProgress } from "@/lib/exam/review";
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS,
  type Difficulty,
  type QuestionType,
  type Subject,
} from "@/lib/constants";
import type { AttemptDoc, ExamDoc, UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ExamDetailViewProps {
  exam: SerializedWithId<ExamDoc>;
  attempts: SerializedWithId<AttemptDoc>[];
  students: SerializedWithId<UserDoc>[];
}

interface StudentPerformanceSummary {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentClass: string | null;
  attempts: SerializedWithId<AttemptDoc>[];
  sittingsCount: number;
  retakeCount: number;
  firstScore: number | null;
  latestScore: number | null;
  bestScore: number | null;
  delta: number | null;
  latestAttemptDate: Date | null;
  averageTimeSpentSeconds: number | null;
  hasPassed: boolean;
}

const ITEMS_PER_PAGE = 10;

export function ExamDetailView({ exam, attempts, students, basePath = "/admin" }: ExamDetailViewProps & { basePath?: string }) {
  const [activeTab, setActiveTab] = useState<string>("students");
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [performanceFilter, setPerformanceFilter] = useState<string>("all");
  const [questionFilter, setQuestionFilter] = useState<string>("all");
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(new Set());

  // Pagination states (batches of 10)
  const [studentPage, setStudentPage] = useState<number>(1);
  const [questionPage, setQuestionPage] = useState<number>(1);

  // Student map for fast O(1) lookup
  const studentMap = useMemo(() => {
    const map = new Map<string, SerializedWithId<UserDoc>>();
    for (const student of students) {
      map.set(student.id, student);
    }
    return map;
  }, [students]);

  // Review status
  const review = useMemo(() => {
    return reviewProgress(exam.questions, exam.review);
  }, [exam.questions, exam.review]);

  // Calculations for KPI cards
  const gradedAttempts = useMemo(
    () => attempts.filter((a) => a.score !== null),
    [attempts],
  );

  const retakeAttempts = useMemo(
    () => attempts.filter((a) => a.retakeOf !== null),
    [attempts],
  );

  const totalPoints = useMemo(
    () => exam.questions.reduce((sum, q) => sum + (q.points || 0), 0),
    [exam.questions],
  );

  const assignedStudentIds = useMemo(
    () => Array.from(new Set(attempts.map((a) => a.studentId))),
    [attempts],
  );

  // Group attempts by student
  const studentSummaries = useMemo<StudentPerformanceSummary[]>(() => {
    const byStudent = new Map<string, SerializedWithId<AttemptDoc>[]>();
    for (const a of attempts) {
      const list = byStudent.get(a.studentId) ?? [];
      list.push(a);
      byStudent.set(a.studentId, list);
    }

    const summaries: StudentPerformanceSummary[] = [];

    for (const [studentId, studentAttempts] of byStudent.entries()) {
      const studentUser = studentMap.get(studentId);
      const sorted = [...studentAttempts].sort((a, b) => {
        const timeA = parseDate(a.createdAt)?.getTime() ?? 0;
        const timeB = parseDate(b.createdAt)?.getTime() ?? 0;
        return timeA - timeB;
      });

      const graded = sorted.filter((a) => a.score !== null);
      const firstScore = graded.length > 0 ? (graded[0]?.score?.percentage ?? null) : null;
      const latestScore =
        graded.length > 0 ? (graded[graded.length - 1]?.score?.percentage ?? null) : null;
      const bestScore = graded.length > 0
        ? Math.max(...graded.map((a) => a.score?.percentage ?? 0))
        : null;

      const delta =
        firstScore !== null && latestScore !== null && graded.length > 1
          ? latestScore - firstScore
          : null;

      const retakes = sorted.filter((a) => a.retakeOf !== null).length;

      const validTimes = sorted
        .map((a) => a.timeSpentSeconds)
        .filter((t): t is number => typeof t === "number" && t > 0);

      const averageTimeSpentSeconds =
        validTimes.length > 0
          ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
          : null;

      const studentName =
        studentUser?.displayName || `Student ${studentId.slice(0, 8)}…`;
      const studentEmail = studentUser?.email || "No email";
      const studentClass = studentUser?.classLevel
        ? studentUser.level === "primary"
          ? `P.${studentUser.classLevel}`
          : `S.${studentUser.classLevel}`
        : null;

      const latestAttemptDate =
        sorted.length > 0 ? parseDate(sorted[sorted.length - 1]?.createdAt) : null;

      summaries.push({
        studentId,
        studentName,
        studentEmail,
        studentClass,
        attempts: sorted,
        sittingsCount: sorted.length,
        retakeCount: retakes,
        firstScore,
        latestScore,
        bestScore,
        delta,
        latestAttemptDate,
        averageTimeSpentSeconds,
        hasPassed: latestScore !== null && latestScore >= 50,
      });
    }

    return summaries.sort((a, b) => {
      if (a.latestScore !== null && b.latestScore !== null) {
        return b.latestScore - a.latestScore;
      }
      if (a.latestScore !== null) return -1;
      if (b.latestScore !== null) return 1;
      return b.sittingsCount - a.sittingsCount;
    });
  }, [attempts, studentMap]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    return studentSummaries.filter((s) => {
      const matchesSearch =
        studentSearch === "" ||
        s.studentName.toLowerCase().includes(studentSearch.toLowerCase()) ||
        s.studentEmail.toLowerCase().includes(studentSearch.toLowerCase()) ||
        s.studentId.toLowerCase().includes(studentSearch.toLowerCase());

      if (!matchesSearch) return false;

      if (performanceFilter === "improved") {
        return s.delta !== null && s.delta > 0;
      }
      if (performanceFilter === "dropped") {
        return s.delta !== null && s.delta < 0;
      }
      if (performanceFilter === "passed") {
        return s.latestScore !== null && s.latestScore >= 50;
      }
      if (performanceFilter === "at_risk") {
        return s.latestScore !== null && s.latestScore < 50;
      }
      if (performanceFilter === "retakes") {
        return s.retakeCount > 0;
      }

      return true;
    });
  }, [studentSummaries, studentSearch, performanceFilter]);

  // Paginated students (10 per batch)
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / ITEMS_PER_PAGE));
  const safeStudentPage = Math.min(studentPage, totalStudentPages);
  const paginatedStudents = useMemo(() => {
    const start = (safeStudentPage - 1) * ITEMS_PER_PAGE;
    return filteredStudents.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredStudents, safeStudentPage]);

  // Overall Statistics
  const stats = useMemo(() => {
    const scores = gradedAttempts
      .map((a) => a.score?.percentage)
      .filter((s): s is number => typeof s === "number");

    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    const highestScore = scores.length ? Math.max(...scores) : null;
    const lowestScore = scores.length ? Math.min(...scores) : null;

    const passCount = scores.filter((s) => s >= 50).length;
    const passRate = scores.length ? Math.round((passCount / scores.length) * 100) : null;

    const improvedRetakers = studentSummaries.filter(
      (s) => s.retakeCount > 0 && s.delta !== null && s.delta > 0,
    );
    const totalRetakers = studentSummaries.filter((s) => s.retakeCount > 0);
    const retakeImprovementRate = totalRetakers.length
      ? Math.round((improvedRetakers.length / totalRetakers.length) * 100)
      : null;

    return {
      avgScore,
      highestScore,
      lowestScore,
      passRate,
      uniqueStudentsCount: studentSummaries.length,
      totalAttemptsCount: attempts.length,
      retakesCount: retakeAttempts.length,
      retakeImprovementRate,
    };
  }, [gradedAttempts, studentSummaries, attempts.length, retakeAttempts.length]);

  // Per-question item analysis
  const questionAnalytics = useMemo(() => {
    return exam.questions.map((q, idx) => {
      let fails = 0;
      let skips = 0;
      let passes = 0;
      let total = 0;

      for (const att of gradedAttempts) {
        const ans = att.answers.find((x) => x.questionId === q.id);
        const isSkipped =
          !ans ||
          ans.response === null ||
          ans.response === "" ||
          (Array.isArray(ans.response) && ans.response.length === 0);

        if (isSkipped) {
          skips += 1;
        } else if (ans?.graded?.correct === false) {
          fails += 1;
        } else if (ans?.graded?.correct === true) {
          passes += 1;
        }
        total += 1;
      }

      const passRate = total ? Math.round((passes / total) * 100) : 0;
      const failRate = total ? Math.round((fails / total) * 100) : 0;
      const skipRate = total ? Math.round((skips / total) * 100) : 0;

      const isHighFail = failRate >= 40 && total >= 3;
      const isHighScore = passRate >= 80 && total >= 3;
      const isHighSkip = skipRate >= 25 && total >= 3;

      return {
        question: q,
        index: idx + 1,
        total,
        passes,
        fails,
        skips,
        passRate,
        failRate,
        skipRate,
        isHighFail,
        isHighScore,
        isHighSkip,
      };
    });
  }, [exam.questions, gradedAttempts]);

  // Filtered Questions
  const filteredQuestions = useMemo(() => {
    return questionAnalytics.filter((qa) => {
      if (questionFilter === "high_fail") return qa.failRate >= 35;
      if (questionFilter === "high_skip") return qa.skipRate >= 20;
      if (questionFilter === "mastered") return qa.passRate >= 75;
      return true;
    });
  }, [questionAnalytics, questionFilter]);

  // Paginated questions (10 per batch)
  const totalQuestionPages = Math.max(1, Math.ceil(filteredQuestions.length / ITEMS_PER_PAGE));
  const safeQuestionPage = Math.min(questionPage, totalQuestionPages);
  const paginatedQuestions = useMemo(() => {
    const start = (safeQuestionPage - 1) * ITEMS_PER_PAGE;
    return filteredQuestions.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredQuestions, safeQuestionPage]);

  const toggleQuestionExpanded = (id: string) => {
    setExpandedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyExamId = async () => {
    try {
      await navigator.clipboard.writeText(exam.id);
      toast.success("Exam ID copied to clipboard");
    } catch {
      toast.error("Could not copy the Exam ID");
    }
  };

  const subjectLabel = SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject;
  const classLabel =
    exam.params.level === "primary" ? `P.${exam.params.classLevel}` : `S.${exam.params.classLevel}`;
  const difficultyLabel = DIFFICULTY_LABELS[exam.params.difficulty as Difficulty] ?? exam.params.difficulty;
  const createdDate = parseDate(exam.createdAt);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Breadcrumb & Top Navigation ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="text-muted-foreground hover:text-foreground -ml-2 gap-1.5 font-medium"
          render={<Link href={`${basePath}/exams`} />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Back to Exam Library</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyExamId}
            className="h-8 gap-1.5 text-xs"
          >
            <CopyIcon className="size-3.5" />
            <span>Copy ID</span>
          </Button>

          <AssignExamDialog
            exam={exam}
            students={students}
            assignedStudentIds={assignedStudentIds}
            size="sm"
            variant="default"
            label="Assign Exam"
            basePath={basePath}
          />
        </div>
      </div>

      {/* ── Hero Header Card ── */}
      <Card className="relative overflow-hidden border-border/80 bg-linear-to-br from-card via-card to-muted/30 shadow-xs">
        <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-primary/20 bg-primary/10 text-primary font-medium px-2.5 py-0.5"
                >
                  <BookOpenIcon className="size-3 mr-1" />
                  {subjectLabel}
                </Badge>

                <Badge variant="secondary" className="font-medium px-2.5 py-0.5">
                  <GraduationCapIcon className="size-3 mr-1" />
                  {classLabel}
                  {exam.params.secondarySubLevel
                    ? ` (${exam.params.secondarySubLevel === "a_level" ? "A-Level" : "O-Level"})`
                    : ""}
                </Badge>

                <Badge
                  variant="outline"
                  className="capitalize font-normal text-muted-foreground border-border/60"
                >
                  {difficultyLabel}
                </Badge>

                <Badge
                  variant="outline"
                  className={`capitalize px-2.5 py-0.5 ${
                    exam.status === "active"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : exam.status === "scheduled"
                        ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                        : exam.status === "draft"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "border-muted-foreground/30 bg-muted text-muted-foreground"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full mr-1.5 inline-block ${
                      exam.status === "active"
                        ? "bg-emerald-500"
                        : exam.status === "scheduled"
                          ? "bg-blue-500"
                          : exam.status === "draft"
                            ? "bg-amber-500"
                            : "bg-muted-foreground"
                    }`}
                  />
                  {exam.status}
                </Badge>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {exam.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm text-muted-foreground pt-1">
                <div className="flex items-center gap-1.5">
                  <FileTextIcon className="size-4 text-primary/70" />
                  <span>{exam.questions.length} Questions</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ClockIcon className="size-4 text-primary/70" />
                  <span>{exam.params.durationMinutes} Minutes</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrophyIcon className="size-4 text-amber-500" />
                  <span>{totalPoints} Total Marks</span>
                </div>
                {createdDate && (
                  <div className="flex items-center gap-1.5">
                    <span>Created {format(createdDate, "MMM d, yyyy")}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick action block */}
            <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0">
              {exam.status === "draft" && (
                <Button
                  size="default"
                  variant={review.complete ? "secondary" : "default"}
                  nativeButton={false}
                  render={<Link href={`${basePath}/exams/${exam.id}/review`} />}
                  className="shadow-xs gap-2"
                >
                  <ClipboardCheckIcon className="size-4" />
                  {review.complete ? "Review & Assign" : "Review Questions"}
                </Button>
              )}

              {exam.status !== "draft" && (
                <Button
                  size="default"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`${basePath}/exams/${exam.id}/review`} />}
                  className="gap-2"
                >
                  <FileTextIcon className="size-4" />
                  Inspect Paper
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Review Progress Notification (if Draft) ── */}
      {exam.status === "draft" && (
        <div
          className={`rounded-xl border p-4 sm:p-5 shadow-xs transition-colors ${
            review.complete
              ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20"
              : "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  review.complete
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                {review.complete ? (
                  <CheckCircle2Icon className="size-5" />
                ) : (
                  <ClipboardCheckIcon className="size-5" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {review.complete
                    ? "Review Completed — All Questions Approved"
                    : `Review in Progress — ${review.approved} of ${review.total} Questions Approved`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {review.complete
                    ? "This exam is ready for scheduling and student assignment."
                    : "Review all AI-generated questions to ensure curriculum accuracy before assigning."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="w-full sm:w-36">
                <Progress
                  value={Math.round((review.approved / Math.max(review.total, 1)) * 100)}
                  className="h-2"
                />
              </div>
              <Button
                size="sm"
                variant={review.complete ? "outline" : "default"}
                nativeButton={false}
                render={<Link href={`${basePath}/exams/${exam.id}/review`} />}
                className="whitespace-nowrap shrink-0"
              >
                {review.complete ? "Open Review" : "Continue Review"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Executive Stat Cards (4-Column Grid) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Average Score */}
        <Card className="hover:border-primary/30 transition-all shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Average Score
              </span>
              <div className="rounded-md bg-primary/10 p-1.5 text-primary">
                <TrophyIcon className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">
                {stats.avgScore !== null ? `${stats.avgScore}%` : "—"}
              </span>
              {stats.avgScore !== null && (
                <Badge
                  variant="outline"
                  className={`text-[11px] font-medium ${
                    stats.avgScore >= 75
                      ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
                      : stats.avgScore >= 60
                        ? "border-blue-500/30 text-blue-600 bg-blue-500/10"
                        : stats.avgScore >= 50
                          ? "border-amber-500/30 text-amber-600 bg-amber-500/10"
                          : "border-destructive/30 text-destructive bg-destructive/10"
                  }`}
                >
                  {stats.avgScore >= 75
                    ? "Distinction"
                    : stats.avgScore >= 60
                      ? "Credit"
                      : stats.avgScore >= 50
                        ? "Pass"
                        : "Remedial"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.highestScore !== null && stats.lowestScore !== null
                ? `High ${stats.highestScore}% · Low ${stats.lowestScore}%`
                : "No graded attempts yet"}
            </p>
          </CardContent>
        </Card>

        {/* Metric 2: Participation */}
        <Card className="hover:border-primary/30 transition-all shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Students Attempted
              </span>
              <div className="rounded-md bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400">
                <UsersIcon className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">
                {stats.uniqueStudentsCount}
              </span>
              <span className="text-xs text-muted-foreground">
                ({stats.totalAttemptsCount} total {stats.totalAttemptsCount === 1 ? "sitting" : "sittings"})
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.uniqueStudentsCount > 0
                ? `${Math.round((stats.uniqueStudentsCount / Math.max(students.length, 1)) * 100)}% class coverage`
                : "Awaiting student sittings"}
            </p>
          </CardContent>
        </Card>

        {/* Metric 3: Retakes & Improvement */}
        <Card className="hover:border-primary/30 transition-all shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Retake Activity
              </span>
              <div className="rounded-md bg-violet-500/10 p-1.5 text-violet-600 dark:text-violet-400">
                <RotateCcwIcon className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">
                {stats.retakesCount}
              </span>
              <span className="text-xs text-muted-foreground">retakes</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.retakeImprovementRate !== null
                ? `${stats.retakeImprovementRate}% improved score on retake`
                : "No retakes recorded"}
            </p>
          </CardContent>
        </Card>

        {/* Metric 4: Pass Rate */}
        <Card className="hover:border-primary/30 transition-all shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pass Rate (≥50%)
              </span>
              <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2Icon className="size-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">
                {stats.passRate !== null ? `${stats.passRate}%` : "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {gradedAttempts.length > 0
                ? `${gradedAttempts.filter((a) => (a.score?.percentage ?? 0) >= 50).length} of ${gradedAttempts.length} submissions passed`
                : "Calculated after submissions"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Main Tabbed Section ── */}
      <Tabs value={activeTab} onValueChange={(val) => { if (val) setActiveTab(val); }} className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="students" className="gap-2 px-3 py-1.5 text-xs sm:text-sm">
              <UsersIcon className="size-4" />
              <span>Student Performance & Retakes</span>
              {studentSummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {studentSummaries.length}
                </Badge>
              )}
            </TabsTrigger>

            <TabsTrigger value="questions" className="gap-2 px-3 py-1.5 text-xs sm:text-sm">
              <BarChart3Icon className="size-4" />
              <span>Question Mastery & Item Analysis</span>
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {exam.questions.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger value="blueprint" className="gap-2 px-3 py-1.5 text-xs sm:text-sm">
              <SlidersHorizontalIcon className="size-4" />
              <span>Exam Blueprint & AI Specs</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ═════════ TAB 1: Student Performance & Retakes ═════════ */}
        <TabsContent value="students" className="mt-4 space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search student name or email…"
                value={studentSearch}
                onChange={(e) => {
                  setStudentSearch(e.target.value);
                  setStudentPage(1);
                }}
                className="pl-9 h-9 text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={performanceFilter}
                onValueChange={(val) => {
                  if (val) {
                    setPerformanceFilter(val);
                    setStudentPage(1);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-44 text-xs sm:text-sm">
                  <SelectValue placeholder="Filter performance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Students</SelectItem>
                  <SelectItem value="improved">Improved on Retake (+Δ)</SelectItem>
                  <SelectItem value="dropped">Dropped on Retake (-Δ)</SelectItem>
                  <SelectItem value="passed">Passed (≥50%)</SelectItem>
                  <SelectItem value="at_risk">At Risk (&lt;50%)</SelectItem>
                  <SelectItem value="retakes">Has Retakes Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Performance Table Card */}
          <Card className="shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[280px]">Student</TableHead>
                    <TableHead className="text-center">Sittings</TableHead>
                    <TableHead className="text-right">First Attempt</TableHead>
                    <TableHead className="text-right">Latest Score</TableHead>
                    <TableHead className="text-right">Best Score</TableHead>
                    <TableHead className="text-center">Retake Delta</TableHead>
                    <TableHead className="text-right">Latest Sitting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedStudents.length > 0 ? (
                    paginatedStudents.map((item) => {
                      const initials = item.studentName
                        .split(" ")
                        .map((n) => n[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase();

                      return (
                        <TableRow key={item.studentId} className="hover:bg-muted/30">
                          {/* Student Info */}
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-3">
                              <Avatar size="sm" className="bg-primary/10 text-primary font-semibold">
                                <AvatarFallback>{initials || "ST"}</AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {item.studentName}
                                  </span>
                                  {item.studentClass && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                      {item.studentClass}
                                    </Badge>
                                  )}
                                </div>
                                <span className="truncate text-xs text-muted-foreground">
                                  {item.studentEmail}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Sittings & Retakes */}
                          <TableCell className="text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <Badge
                                variant={item.sittingsCount > 1 ? "secondary" : "outline"}
                                className="text-xs"
                              >
                                {item.sittingsCount} {item.sittingsCount === 1 ? "sitting" : "sittings"}
                              </Badge>
                              {item.retakeCount > 0 && (
                                <Badge
                                  variant="outline"
                                  className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[10px] px-1.5 py-0"
                                >
                                  {item.retakeCount} retake{item.retakeCount > 1 ? "s" : ""}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          {/* First Attempt */}
                          <TableCell className="text-right tabular-nums text-sm">
                            {item.firstScore !== null ? (
                              <span>{item.firstScore}%</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {/* Latest Score */}
                          <TableCell className="text-right tabular-nums">
                            {item.latestScore !== null ? (
                              <Badge
                                variant="outline"
                                className={`text-xs font-semibold px-2 py-0.5 ${
                                  item.latestScore >= 75
                                    ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-300"
                                    : item.latestScore >= 50
                                      ? "border-blue-500/30 text-blue-700 bg-blue-500/10 dark:text-blue-300"
                                      : "border-destructive/30 text-destructive bg-destructive/10"
                                }`}
                              >
                                {item.latestScore}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">Ungraded</span>
                            )}
                          </TableCell>

                          {/* Best Score */}
                          <TableCell className="text-right tabular-nums text-sm text-foreground/80 font-medium">
                            {item.bestScore !== null ? (
                              <span>{item.bestScore}%</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {/* Retake Delta */}
                          <TableCell className="text-center tabular-nums">
                            {item.delta !== null ? (
                              <Badge
                                variant="outline"
                                className={`text-xs font-medium gap-1 ${
                                  item.delta > 0
                                    ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
                                    : item.delta < 0
                                      ? "border-destructive/30 text-destructive bg-destructive/10"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {item.delta > 0 ? (
                                  <TrendingUpIcon className="size-3" />
                                ) : item.delta < 0 ? (
                                  <TrendingDownIcon className="size-3" />
                                ) : null}
                                {item.delta > 0 ? `+${item.delta}%` : `${item.delta}%`}
                              </Badge>
                            ) : item.sittingsCount === 1 ? (
                              <span className="text-xs text-muted-foreground">Initial attempt</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {/* Latest Sitting Date */}
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {item.latestAttemptDate ? (
                              format(item.latestAttemptDate, "MMM d, HH:mm")
                            ) : (
                              <span>—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                          <UsersIcon className="size-6 opacity-40" />
                          <p className="text-sm font-medium">No students match the criteria</p>
                          <p className="text-xs">
                            {studentSearch || performanceFilter !== "all"
                              ? "Try adjusting your search or filters."
                              : "No students have sat for this exam yet."}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls (Batches of 10) */}
            {filteredStudents.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 bg-muted/20 text-xs text-muted-foreground">
                <div>
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {(safeStudentPage - 1) * ITEMS_PER_PAGE + 1}–
                    {Math.min(safeStudentPage * ITEMS_PER_PAGE, filteredStudents.length)}
                  </span>{" "}
                  of <span className="font-medium text-foreground">{filteredStudents.length}</span> students
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safeStudentPage <= 1}
                    onClick={() => setStudentPage(1)}
                    title="First page"
                  >
                    <ChevronsLeftIcon className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safeStudentPage <= 1}
                    onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                    title="Previous page"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </Button>

                  <span className="px-2 font-medium text-foreground">
                    Page {safeStudentPage} of {totalStudentPages}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safeStudentPage >= totalStudentPages}
                    onClick={() => setStudentPage((p) => Math.min(totalStudentPages, p + 1))}
                    title="Next page"
                  >
                    <ChevronRightIcon className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safeStudentPage >= totalStudentPages}
                    onClick={() => setStudentPage(totalStudentPages)}
                    title="Last page"
                  >
                    <ChevronsRightIcon className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ═════════ TAB 2: Question Mastery & Item Analysis ═════════ */}
        <TabsContent value="questions" className="mt-4 space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <p className="text-xs sm:text-sm text-muted-foreground">
              Deep diagnostic metrics on question difficulty, error distribution, and student comprehension.
            </p>

            <Select
              value={questionFilter}
              onValueChange={(val) => {
                if (val) {
                  setQuestionFilter(val);
                  setQuestionPage(1);
                }
              }}
            >
              <SelectTrigger className="h-9 w-48 text-xs sm:text-sm">
                <SelectValue placeholder="Filter questions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {exam.questions.length} Questions</SelectItem>
                <SelectItem value="high_fail">High Fail Rate (&gt;35%)</SelectItem>
                <SelectItem value="high_skip">High Skip Rate (&gt;20%)</SelectItem>
                <SelectItem value="mastered">High Mastery (&gt;75%)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Question List (Batches of 10) */}
          <div className="space-y-3">
            {paginatedQuestions.length > 0 ? (
              paginatedQuestions.map((qa) => {
                const isExpanded = expandedQuestionIds.has(qa.question.id);
                const qTypeLabel =
                  QUESTION_TYPE_LABELS[qa.question.type as QuestionType] ?? qa.question.type;

                return (
                  <Card
                    key={qa.question.id}
                    className={`transition-all shadow-xs ${
                      qa.isHighFail
                        ? "border-destructive/30 dark:border-destructive/40"
                        : "border-border/80"
                    }`}
                  >
                    <CardHeader className="p-4 pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="font-mono text-xs font-semibold px-2"
                          >
                            Q{qa.index}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {qTypeLabel}
                          </Badge>
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {qa.question.points} {qa.question.points === 1 ? "Mark" : "Marks"}
                          </Badge>
                        </div>

                        {/* Visual rate chips */}
                        <div className="flex items-center gap-2">
                          {qa.total > 0 ? (
                            <>
                              <Badge
                                variant="outline"
                                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs"
                              >
                                {qa.passRate}% Pass
                              </Badge>
                              <Badge
                                variant="outline"
                                className="border-destructive/30 bg-destructive/10 text-destructive text-xs"
                              >
                                {qa.failRate}% Fail
                              </Badge>
                              {qa.skipRate > 0 && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs"
                                >
                                  {qa.skipRate}% Skipped
                                </Badge>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">No attempts yet</span>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleQuestionExpanded(qa.question.id)}
                            className="h-7 w-7 p-0 ml-1"
                          >
                            {isExpanded ? (
                              <ChevronUpIcon className="size-4" />
                            ) : (
                              <ChevronDownIcon className="size-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 pt-2 space-y-3">
                      {/* Question prompt rendered cleanly with Markdown/LaTeX */}
                      <div className="text-sm font-normal text-foreground leading-relaxed">
                        <Markdown>{qa.question.prompt}</Markdown>
                      </div>

                      {/* Performance Bar (Pass / Fail / Skip) */}
                      {qa.total > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Item Performance ({qa.total} submissions evaluated)</span>
                            <span className="tabular-nums font-medium">
                              {qa.passes} correct · {qa.fails} incorrect · {qa.skips} skipped
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                            <div
                              style={{ width: `${qa.passRate}%` }}
                              className="bg-emerald-500 transition-all"
                              title={`Pass: ${qa.passRate}%`}
                            />
                            <div
                              style={{ width: `${qa.failRate}%` }}
                              className="bg-destructive transition-all"
                              title={`Fail: ${qa.failRate}%`}
                            />
                            <div
                              style={{ width: `${qa.skipRate}%` }}
                              className="bg-amber-500 transition-all"
                              title={`Skipped: ${qa.skipRate}%`}
                            />
                          </div>
                        </div>
                      )}

                      {/* AI Diagnostic Callout */}
                      {qa.isHighFail && (
                        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                          <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">Remedial Focus Alert:</span> High failure rate ({qa.failRate}%). Students consistently struggled with this concept. Consider reviewing during class or preparing a targeted follow-up worksheet.
                          </div>
                        </div>
                      )}

                      {qa.isHighSkip && !qa.isHighFail && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                          <HelpCircleIcon className="size-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">Assessment Clarity Note:</span> High skip rate ({qa.skipRate}%). Students frequently bypassed this question; evaluate whether the phrasing was ambiguous or time-constraining.
                          </div>
                        </div>
                      )}

                      {/* Expanded Details: Options, Explanations, Hints */}
                      {isExpanded && (
                        <div className="border-t pt-3 mt-3 space-y-3 text-xs">
                          {/* Options if Multiple Choice */}
                          {qa.question.options && qa.question.options.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                                Answer Choices
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {qa.question.options.map((opt, optIdx) => {
                                  const isCorrect =
                                    qa.question.correctOptionIndex === optIdx;
                                  return (
                                    <div
                                      key={optIdx}
                                      className={`rounded-md border p-2.5 flex items-start gap-2 ${
                                        isCorrect
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200 font-medium"
                                          : "border-border/60 bg-muted/20 text-muted-foreground"
                                      }`}
                                    >
                                      <span
                                        className={`size-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                          isCorrect
                                            ? "bg-emerald-500 text-white"
                                            : "bg-muted text-foreground"
                                        }`}
                                      >
                                        {String.fromCharCode(65 + optIdx)}
                                      </span>
                                      <div className="flex-1">
                                        <Markdown>{opt}</Markdown>
                                      </div>
                                      {isCorrect && (
                                        <Badge
                                          variant="outline"
                                          className="text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 py-0 h-4"
                                        >
                                          Correct Answer
                                        </Badge>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* True / False correct answer */}
                          {qa.question.type === "true_false" &&
                            qa.question.correctBool !== null && (
                              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                                <CheckCircle2Icon className="size-4 text-emerald-600" />
                                <span>
                                  Correct statement is:{" "}
                                  <strong>{qa.question.correctBool ? "TRUE" : "FALSE"}</strong>
                                </span>
                              </div>
                            )}

                          {/* Explanation */}
                          {qa.question.explanation && (
                            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                              <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                                <LightbulbIcon className="size-3.5 text-amber-500" />
                                <span>Explanation & Pedagogical Reasoning</span>
                              </div>
                              <div className="text-xs text-muted-foreground leading-relaxed">
                                <Markdown>{qa.question.explanation}</Markdown>
                              </div>
                            </div>
                          )}

                          {/* Worked Example */}
                          {qa.question.workedExample && (
                            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                              <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                                <FileTextIcon className="size-3.5 text-primary" />
                                <span>Worked Step-by-Step Solution</span>
                              </div>
                              <div className="text-xs text-muted-foreground leading-relaxed">
                                <Markdown>{qa.question.workedExample}</Markdown>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p className="text-sm font-medium">No questions match the selected filter</p>
                  <p className="text-xs mt-1">Try switching to &quot;All Questions&quot;.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Question Pagination Controls (Batches of 10) */}
          {filteredQuestions.length > ITEMS_PER_PAGE && (
            <div className="flex flex-wrap items-center justify-between gap-3 border rounded-xl px-4 py-3 bg-card shadow-xs text-xs text-muted-foreground">
              <div>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {(safeQuestionPage - 1) * ITEMS_PER_PAGE + 1}–
                  {Math.min(safeQuestionPage * ITEMS_PER_PAGE, filteredQuestions.length)}
                </span>{" "}
                of <span className="font-medium text-foreground">{filteredQuestions.length}</span> questions
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={safeQuestionPage <= 1}
                  onClick={() => setQuestionPage(1)}
                  title="First page"
                >
                  <ChevronsLeftIcon className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={safeQuestionPage <= 1}
                  onClick={() => setQuestionPage((p) => Math.max(1, p - 1))}
                  title="Previous page"
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>

                <span className="px-2 font-medium text-foreground">
                  Page {safeQuestionPage} of {totalQuestionPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={safeQuestionPage >= totalQuestionPages}
                  onClick={() => setQuestionPage((p) => Math.min(totalQuestionPages, p + 1))}
                  title="Next page"
                >
                  <ChevronRightIcon className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={safeQuestionPage >= totalQuestionPages}
                  onClick={() => setQuestionPage(totalQuestionPages)}
                  title="Last page"
                >
                  <ChevronsRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═════════ TAB 3: Exam Blueprint & AI Specs ═════════ */}
        <TabsContent value="blueprint" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Specification Card */}
            <Card className="shadow-xs">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <LayersIcon className="size-4 text-primary" />
                  Curriculum & Structure Blueprint
                </CardTitle>
                <CardDescription>
                  Configuration parameters used to construct this assessment.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm divide-y">
                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Subject</span>
                  <span className="font-medium text-foreground">{subjectLabel}</span>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-muted-foreground">Class & Level</span>
                  <span className="font-medium text-foreground">
                    {classLabel} ({exam.params.level === "primary" ? "Primary" : "Secondary"})
                  </span>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-muted-foreground">Topic</span>
                  <span className="font-medium text-foreground">{exam.params.topic || "General"}</span>
                </div>
                {exam.params.subsidiary && (
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-muted-foreground">Subsidiary / Branch</span>
                    <span className="font-medium text-foreground">{exam.params.subsidiary}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-3">
                  <span className="text-muted-foreground">Target Difficulty</span>
                  <Badge variant="outline" className="capitalize">
                    {difficultyLabel}
                  </Badge>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium text-foreground">{exam.params.durationMinutes} Minutes</span>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-muted-foreground">Total Questions & Points</span>
                  <span className="font-medium text-foreground">
                    {exam.questions.length} Items ({totalPoints} Marks)
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Integrity & Proctoring Rules Card */}
            <Card className="shadow-xs">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                  Integrity & Proctoring Controls
                </CardTitle>
                <CardDescription>
                  Enforced security standards during student exam sittings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm divide-y">
                <div className="flex items-center justify-between pt-1">
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">Strict Fullscreen</p>
                    <p className="text-xs text-muted-foreground">Locks window and detects tab switching</p>
                  </div>
                  <Badge
                    variant={exam.params.requireFullscreen ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {exam.params.requireFullscreen ? "Enforced" : "Disabled"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">Anti-Backtracking</p>
                    <p className="text-xs text-muted-foreground">Prevents returning to previous questions</p>
                  </div>
                  <Badge
                    variant={exam.params.preventBacktrack ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {exam.params.preventBacktrack ? "Enabled" : "Disabled"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">Review Before Submit</p>
                    <p className="text-xs text-muted-foreground">Allows final review pass before completion</p>
                  </div>
                  <Badge
                    variant={exam.params.allowReviewBeforeSubmit ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {exam.params.allowReviewBeforeSubmit ? "Allowed" : "Restricted"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">Allow Skipping</p>
                    <p className="text-xs text-muted-foreground">Students may bypass questions to answer later</p>
                  </div>
                  <Badge
                    variant={exam.params.allowSkipping ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {exam.params.allowSkipping ? "Allowed" : "Required"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* AI Telemetry & Usage */}
            <Card className="shadow-xs lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CpuIcon className="size-4 text-primary" />
                  AI Generation Telemetry & Cost Accounting
                </CardTitle>
                <CardDescription>
                  Token consumption and model operational telemetry for this paper.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div className="rounded-xl border p-4 bg-muted/20">
                  <p className="text-xs text-muted-foreground uppercase font-medium">Generation Tokens</p>
                  <p className="text-xl font-bold tracking-tight mt-1 tabular-nums">
                    {(exam.usage?.generationInputTokens ?? 0) + (exam.usage?.generationOutputTokens ?? 0) > 0
                      ? (
                          (exam.usage?.generationInputTokens ?? 0) +
                          (exam.usage?.generationOutputTokens ?? 0)
                        ).toLocaleString()
                      : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Input: {exam.usage?.generationInputTokens?.toLocaleString() ?? 0} · Output:{" "}
                    {exam.usage?.generationOutputTokens?.toLocaleString() ?? 0}
                  </p>
                </div>

                <div className="rounded-xl border p-4 bg-muted/20">
                  <p className="text-xs text-muted-foreground uppercase font-medium">Grading Tokens</p>
                  <p className="text-xl font-bold tracking-tight mt-1 tabular-nums">
                    {(exam.usage?.gradingTokens ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Consumed across student AI evaluation
                  </p>
                </div>

                <div className="rounded-xl border p-4 bg-muted/20">
                  <p className="text-xs text-muted-foreground uppercase font-medium">Revision Tokens</p>
                  <p className="text-xl font-bold tracking-tight mt-1 tabular-nums">
                    {(exam.usage?.revisionTokens ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Consumed during teacher refinement
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
