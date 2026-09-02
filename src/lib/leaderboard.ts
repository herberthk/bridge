/**
 * Pure class leaderboard maths — no I/O, so ranking is unit-testable and the
 * service layer only fetches the inputs.
 *
 * Ranking: by mean score percentage across graded attempts (the fairest single
 * number across exams of different point values), tie-broken by best single
 * attempt, then by fewer attempts (consistency), then alphabetical. Students
 * with no graded attempts are unranked and listed at the bottom.
 */

export interface LeaderboardAttempt {
  studentId: string;
  status: string;
  /** Percent 0–100, present on graded attempts. */
  score: { earned: number; possible: number; percentage: number } | null;
  submittedAt?: unknown;
}

export interface LeaderboardStudent {
  id: string;
  displayName: string;
}

export interface LeaderboardEntry {
  studentId: string;
  displayName: string;
  /** null while the student has no graded attempts (unranked). */
  rank: number | null;
  attemptsTaken: number;
  bestPercentage: number | null;
  averagePercentage: number | null;
  totalMarksEarned: number;
  totalMarksPossible: number;
  /** Mean minus previous attempt mean — positive when improving. */
  trend: number | null;
}

/** Class-level aggregates shown next to the leaderboard. */
export interface ClassPerformanceStats {
  students: number;
  gradedAttempts: number;
  /** Mean percentage across ALL graded attempts in the class. */
  averagePercentage: number | null;
  /** Share of students with at least one graded attempt (0–100). */
  participationRate: number;
  topPercentage: number | null;
}

function attemptSortKey(a: LeaderboardAttempt): number {
  const submitted = (a as { submittedAt?: { toMillis?: () => number } }).submittedAt;
  return typeof submitted?.toMillis === "function" ? submitted.toMillis() : 0;
}

export function buildLeaderboard(
  students: LeaderboardStudent[],
  attempts: LeaderboardAttempt[],
): LeaderboardEntry[] {
  const byStudent = new Map<string, LeaderboardAttempt[]>();
  for (const attempt of attempts) {
    if (attempt.status !== "graded" || !attempt.score) continue;
    const list = byStudent.get(attempt.studentId) ?? [];
    list.push(attempt);
    byStudent.set(attempt.studentId, list);
  }

  const entries: LeaderboardEntry[] = students.map((student) => {
    const own = (byStudent.get(student.id) ?? []).slice().sort(attemptSortKey);
    const percentages = own.map((a) => a.score!.percentage);
    const best = percentages.length ? Math.max(...percentages) : null;
    const average = percentages.length
      ? percentages.reduce((sum, p) => sum + p, 0) / percentages.length
      : null;
    let trend: number | null = null;
    if (percentages.length >= 2) {
      const last = percentages[percentages.length - 1]!;
      const previous =
        percentages.slice(0, -1).reduce((sum, p) => sum + p, 0) /
        (percentages.length - 1);
      trend = Math.round((last - previous) * 10) / 10;
    }
    return {
      studentId: student.id,
      displayName: student.displayName,
      rank: null,
      attemptsTaken: own.length,
      bestPercentage: best === null ? null : Math.round(best * 10) / 10,
      averagePercentage: average === null ? null : Math.round(average * 10) / 10,
      totalMarksEarned: own.reduce((sum, a) => sum + a.score!.earned, 0),
      totalMarksPossible: own.reduce((sum, a) => sum + a.score!.possible, 0),
      trend,
    };
  });

  // Rank everyone with data; unranked students keep rank null and sort last.
  const ranked = entries
    .filter((e) => e.averagePercentage !== null)
    .sort(
      (a, b) =>
        b.averagePercentage! - a.averagePercentage! ||
        b.bestPercentage! - a.bestPercentage! ||
        a.attemptsTaken - b.attemptsTaken ||
        a.displayName.localeCompare(b.displayName),
    );
  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return [...ranked, ...entries.filter((e) => e.rank === null)].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
}

export function buildClassStats(
  students: LeaderboardStudent[],
  attempts: LeaderboardAttempt[],
): ClassPerformanceStats {
  const graded = attempts.filter((a) => a.status === "graded" && a.score);
  const percentages = graded.map((a) => a.score!.percentage);
  const studentsWithGrades = new Set(graded.map((a) => a.studentId));
  return {
    students: students.length,
    gradedAttempts: graded.length,
    averagePercentage: percentages.length
      ? Math.round((percentages.reduce((s, p) => s + p, 0) / percentages.length) * 10) / 10
      : null,
    participationRate: students.length
      ? Math.round((studentsWithGrades.size / students.length) * 100)
      : 0,
    topPercentage: percentages.length ? Math.round(Math.max(...percentages) * 10) / 10 : null,
  };
}
