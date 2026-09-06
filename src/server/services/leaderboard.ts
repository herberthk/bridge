import { attemptsCol, classDoc, examDoc, userDoc, usersCol } from "@/server/firebase/collections";
import {
  buildClassStats,
  buildLeaderboard,
  type ClassPerformanceStats,
  type LeaderboardEntry,
} from "@/lib/leaderboard";
import { isMissingIndexError } from "@/lib/firestore-errors";
import {
  CLASS_ROSTER_LIMIT,
  countClassStudents,
  fetchClassStudents,
  getClassForActor,
} from "@/server/services/classes";
import type { SessionUser } from "@/server/auth/session";
import type { AttemptDoc, ClassDoc, UserDoc, WithId } from "@/types/firestore";

export class LeaderboardServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/**
 * Class leaderboard + overall performance.
 *
 * Reads only (no denormalized counters to drift): students come from the class
 * membership and attempts are fetched per student id in Firestore "in" chunks
 * of 10. Class sizes are small, so one or two round trips cover a class.
 */

export interface ClassLeaderboardResult {
  classInfo: WithId<ClassDoc>;
  entries: LeaderboardEntry[];
  stats: ClassPerformanceStats;
}

/** Pure ranking build for the bundled reader. */
function toLeaderboardResult(
  cls: WithId<ClassDoc>,
  students: WithId<UserDoc>[],
  gradedAttempts: WithId<AttemptDoc>[],
  studentCount: number,
): ClassLeaderboardResult {
  const roster = students.map((s) => ({ id: s.id, displayName: s.displayName }));
  const lean = gradedAttempts.map((a) => ({
    studentId: a.studentId,
    status: a.status,
    score: a.score,
    submittedAt: a.submittedAt,
  }));
  return {
    classInfo: cls,
    entries: buildLeaderboard(roster, lean),
    // Rates reflect the listed slice; the headcount stays exact even when the
    // roster list hits its cap.
    stats: {
      ...buildClassStats(
        roster,
        lean.map(({ studentId, status, score }) => ({ studentId, status, score })),
      ),
      students: studentCount,
    },
  };
}

function logBundleError(
  actor: SessionUser,
  classId: string,
  scope: string,
  err: unknown,
): void {
  console.error(`[leaderboard] ${scope} failed`, {
    actorId: actor.uid,
    actorRole: actor.role,
    schoolId: actor.schoolId ?? null,
    classId,
    missingIndex: isMissingIndexError(err),
    error: err,
  });
}

export interface ClassDashboardBundle {
  cls: WithId<ClassDoc>;
  /** Newest roster slice (capped) for the roster tab. */
  students: WithId<UserDoc>[];
  /** Exact headcount — the capped list length would lie for oversized classes. */
  studentCount: number;
  leaderboard: ClassLeaderboardResult | null;
  performance: ClassExamPerformance[];
  /** Widget scopes that fell back — rendered as a banner, never silent. */
  degraded: string[];
}

/**
 * Roster + leaderboard + per-exam performance in one call: a single roster
 * read and a single attempts fan-out shared by all three (previously three
 * roster reads and two fan-outs per dashboard load).
 *
 * Auth/unknown-class errors throw (callers map `ClassesServiceError` to 404);
 * a failed roster read throws (callers fail loud — never an empty roster for
 * a backend failure). Failed attempts degrade leaderboard and performance to
 * empty with names in `degraded`.
 */
export async function getClassDashboardBundle(
  actor: SessionUser,
  classId: string,
): Promise<ClassDashboardBundle> {
  const cls = await getClassForActor(actor, classId);
  const students = await fetchClassStudents(classId);
  // Exact total only costs an extra aggregation when the list may be capped;
  // otherwise the list length is already exact.
  const studentCount =
    students.length < CLASS_ROSTER_LIMIT ? students.length : await countClassStudents(classId);

  const degraded: string[] = [];
  const attempts = await listAttemptsForStudents(students.map((s) => s.id)).catch(
    (err: unknown) => {
      logBundleError(actor, classId, "attempts", err);
      degraded.push("Leaderboard", "Performance");
      return null;
    },
  );
  if (!attempts)
    return { cls, students, studentCount, leaderboard: null, performance: [], degraded };

  const graded = attempts.filter((a) => a.status === "graded" && a.score);
  const performance = await buildExamPerformance(attempts).catch((err: unknown) => {
    logBundleError(actor, classId, "exam-titles", err);
    if (!degraded.includes("Performance")) degraded.push("Performance");
    return [] as ClassExamPerformance[];
  });
  return {
    cls,
    students,
    studentCount,
    leaderboard: toLeaderboardResult(cls, students, graded, studentCount),
    performance,
    degraded,
  };
}

export interface StudentClassStanding {
  className: string;
  /** Null until the student has a graded attempt (unranked). */
  rank: number | null;
  rankedTotal: number;
  classAverage: number | null;
  topPercentage: number | null;
}

/**
 * Where one student stands in their own class, for dashboards.
 *
 * Classmates' names and scores never leave the server — ranking runs through
 * the shared pure builder internally, but only the student's own rank plus
 * class aggregates are returned. Null when unassigned, scoreless, or
 * classless: callers render "—", never an error.
 */
export async function getStudentClassStanding(
  actor: SessionUser,
): Promise<StudentClassStanding | null> {
  if (actor.role !== "student") return null;
  const me = await userDoc(actor.uid).get().catch(() => null);
  const classId = me?.exists ? me.data()!.classId : null;
  if (!classId) return null;

  const [cls, studentsSnap] = await Promise.all([
    classDoc(classId).get().catch(() => null),
    usersCol().where("role", "==", "student").where("classId", "==", classId).get(),
  ]);
  const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data()! }));
  if (!students.some((s) => s.id === actor.uid)) return null;
  const attempts = await listAttemptsForStudents(students.map((s) => s.id));

  const lean = attempts.map((a) => ({
    studentId: a.studentId,
    status: a.status,
    score: a.score,
    submittedAt: a.submittedAt,
  }));
  const entries = buildLeaderboard(
    students.map((s) => ({ id: s.id, displayName: s.displayName })),
    lean,
  );
  const stats = buildClassStats(
    students.map((s) => ({ id: s.id, displayName: s.displayName })),
    lean.map(({ studentId, status, score }) => ({ studentId, status, score })),
  );
  const mine = entries.find((e) => e.studentId === actor.uid);
  if (!mine) return null;
  return {
    className: cls?.exists ? cls.data()!.name : "My class",
    rank: mine.rank,
    rankedTotal: entries.filter((e) => e.rank !== null).length,
    classAverage: stats.averagePercentage,
    topPercentage: stats.topPercentage,
  };
}

/** All attempts (any status) for a set of students — chunked "in" queries. */
export async function listAttemptsForStudents(
  studentIds: string[],
): Promise<WithId<AttemptDoc>[]> {
  const CHUNK = 10;
  const results: WithId<AttemptDoc>[] = [];
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const chunk = studentIds.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const snap = await attemptsCol()
      .where("studentId", "in", chunk)
      .limit(500)
      .get();
    results.push(...snap.docs.map((d) => ({ id: d.id, ...d.data()! })));
  }
  return results;
}

/** Per-exam performance breakdown for a class dashboard. */
export interface ClassExamPerformance {
  examId: string;
  title: string;
  attemptsTaken: number;
  gradedCount: number;
  averagePercentage: number | null;
  highestPercentage: number | null;
  lowestPercentage: number | null;
}

/** Group attempts per exam with avg/high/low — titles resolve in parallel. */
async function buildExamPerformance(
  attempts: WithId<AttemptDoc>[],
): Promise<ClassExamPerformance[]> {
  const byExam = new Map<string, WithId<AttemptDoc>[]>();
  for (const attempt of attempts) {
    const list = byExam.get(attempt.examId) ?? [];
    list.push(attempt);
    byExam.set(attempt.examId, list);
  }

  const groups = [...byExam.entries()];
  const titles = await Promise.all(groups.map(([examId]) => examTitle(examId)));
  const performances = groups.map(([examId, examAttempts], i) => {
    const graded = examAttempts.filter((a) => a.status === "graded" && a.score);
    const percentages = graded.map((a) => a.score!.percentage);
    return {
      examId,
      title: titles[i] ?? "Exam",
      attemptsTaken: examAttempts.length,
      gradedCount: graded.length,
      averagePercentage: percentages.length
        ? Math.round((percentages.reduce((s, p) => s + p, 0) / percentages.length) * 10) / 10
        : null,
      highestPercentage: percentages.length ? Math.round(Math.max(...percentages) * 10) / 10 : null,
      lowestPercentage: percentages.length ? Math.round(Math.min(...percentages) * 10) / 10 : null,
    };
  });
  return performances.sort((a, b) => b.gradedCount - a.gradedCount).slice(0, 20);
}

const titleCache = new Map<string, string>();
async function examTitle(examId: string): Promise<string> {
  const cached = titleCache.get(examId);
  if (cached) return cached;
  const snap = await examDoc(examId).get().catch(() => null);
  const title = snap?.exists ? snap.data()!.title : "Exam";
  titleCache.set(examId, title);
  return title;
}
