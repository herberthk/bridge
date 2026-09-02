import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  attemptsCol,
  countQuery,
  dailyMetricDoc,
  examsCol,
  metricsCol,
  schoolsCol,
  usersCol,
  walletsCol,
} from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, DailyMetricDoc } from "@/types/firestore";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";

/* ─────────────────────────── Student ─────────────────────────── */

export interface StudentDashboardData {
  taken: number;
  pending: number;
  averageScore: number | null;
  trend: { label: string; score: number }[];
  bySubject: { subject: string; score: number; taken: number }[];
  strongest: string | null;
  weakest: string | null;
  retakes: number;
  retakesByExam: { examId: string; title: string; subject: string; count: number; latestScore: number | null; improvement: number | null }[];
}

export async function studentDashboard(
  actor: SessionUser,
): Promise<StudentDashboardData> {
  const snap = await attemptsCol()
    .where("studentId", "==", actor.uid)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  const attempts = snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
  const graded = attempts.filter((a) => a.score !== null);

  // Join exam subjects lazily via the exam collection.
  const examSubjects = new Map<string, string>();
  await Promise.all(
    [...new Set(attempts.map((a) => a.examId))].map(async (examId) => {
      const e = await examsCol().doc(examId).get().catch(() => null);
      if (e?.exists) examSubjects.set(examId, e.data()!.params.subject);
    }),
  );

  const bySubjectMap = new Map<string, { total: number; count: number }>();
  for (const a of graded) {
    const subject = examSubjects.get(a.examId) ?? "other";
    const cur = bySubjectMap.get(subject) ?? { total: 0, count: 0 };
    cur.total += a.score!.percentage;
    cur.count += 1;
    bySubjectMap.set(subject, cur);
  }
  const bySubject = [...bySubjectMap.entries()]
    .map(([subject, v]) => ({
      subject: SUBJECT_LABELS[subject as Subject] ?? subject,
      score: Math.round(v.total / v.count),
      taken: v.count,
    }))
    .sort((a, b) => b.score - a.score);

  const trend = graded
    .slice(0, 8)
    .reverse()
    .map((a, i) => ({
      label: a.score ? `${a.score.earned}/${a.score.possible}` : `${i + 1}`,
      score: a.score!.percentage,
    }));

  // Retakes approved per exam for this student — count AttemptDocs where retakeOf != null grouped by examId
  const retakeAttempts = attempts.filter((a) => a.retakeOf !== null && a.retakeOf !== undefined);
  const retakesByExamMap = new Map<string, typeof retakeAttempts>();
  for (const ra of retakeAttempts) {
    const list = retakesByExamMap.get(ra.examId) ?? [];
    list.push(ra);
    retakesByExamMap.set(ra.examId, list);
  }
  const retakesByExam = [...retakesByExamMap.entries()].map(([examId, list]) => {
    return {
      examId,
      title: examId,
      subject: examSubjects.get(examId) ?? "other",
      count: list.length,
      latestScore: list.filter((a) => a.score).sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0))[0]?.score?.percentage ?? null,
      improvement: null as number | null,
    };
  });
  // Enrich titles/subjects properly — fetch exam titles for retake exams
  if (retakesByExam.length > 0) {
    const retakeExamIds = [...retakesByExamMap.keys()];
    const titleMap = new Map<string, { title: string; subject: string }>();
    await Promise.all(
      retakeExamIds.map(async (examId) => {
        const e = await examsCol().doc(examId).get().catch(() => null);
        if (e?.exists) {
          const d = e.data()!;
          titleMap.set(examId, { title: d.title, subject: d.params.subject });
        }
      }),
    );
    for (const entry of retakesByExam) {
      const meta = titleMap.get(entry.examId);
      if (meta) {
        entry.title = meta.title;
        entry.subject = SUBJECT_LABELS[meta.subject as Subject] ?? meta.subject;
      } else {
        entry.subject = SUBJECT_LABELS[entry.subject as Subject] ?? entry.subject;
      }
      // improvement: latest retake vs first attempt of same exam
      const allForExam = attempts.filter((a) => a.examId === entry.examId && a.score !== null).sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      if (allForExam.length >= 2) {
        const first = allForExam[0]!.score!.percentage;
        const latest = allForExam[allForExam.length - 1]!.score!.percentage;
        entry.improvement = latest - first;
      }
    }
  }

  return {
    taken: graded.length,
    pending: attempts.filter((a) => a.status === "pending" || a.status === "in_progress").length,
    averageScore: graded.length
      ? Math.round(graded.reduce((n, a) => n + a.score!.percentage, 0) / graded.length)
      : null,
    trend,
    bySubject,
    strongest: bySubject[0]?.subject ?? null,
    weakest: bySubject.length > 1 ? bySubject[bySubject.length - 1].subject : null,
    retakes: retakeAttempts.length,
    retakesByExam: retakesByExam.sort((a, b) => b.count - a.count),
  };
}

/* ─────────────────────────── Admin ─────────────────────────── */

export interface AdminDashboardData {
  studentCount: number;
  examCount: number;
  attemptsTotal: number;
  averageScore: number | null;
  attemptsByDay: { date: string; attempts: number }[];
  bySubject: { subject: string; attempts: number }[];
  walletBalance: number;
  tokensConsumed: number;
  retakesTotal: number;
  retakeRate: number | null;
  retakesByExam: { examId: string; title: string; subject: string; count: number; uniqueRetakers: number; avgImprovement: number | null }[];
  // Per-exam detailed assessment for each exam (graded) — used for admin exam detail expansion
  perExamDetailed: {
    examId: string;
    title: string;
    subject: string;
    totalAttempts: number;
    gradedCount: number;
    avgScore: number | null;
    retakeCount: number;
    failedQuestionRates: { questionId: string; prompt: string; failRate: number; skippedRate: number }[];
  }[];
}

export async function adminDashboard(
  actor: SessionUser,
): Promise<AdminDashboardData> {
  const walletId = actor.schoolId ?? actor.uid;
  const schoolFilter = actor.schoolId ?? null;

  let attemptsQuery = attemptsCol().limit(1000);
  if (schoolFilter) {
    attemptsQuery = attemptsCol()
      .where("schoolId", "==", schoolFilter)
      .limit(1000);
  }

  const [studentsSnap, examsSnap, attemptsSnap, walletSnap] = await Promise.all([
    schoolFilter
      ? usersCol().where("role", "==", "student").where("schoolId", "==", schoolFilter).get()
      : usersCol().where("role", "==", "student").where("createdBy", "==", actor.uid).get(),
    schoolFilter
      ? examsCol().where("schoolId", "==", schoolFilter).get()
      : examsCol().where("createdBy", "==", actor.uid).get(),
    attemptsQuery.get(),
    walletsCol().doc(walletId).get(),
  ]);

  const attempts = attemptsSnap.docs.map((d) => d.data()!);
  const graded = attempts.filter((a) => a.score !== null);

  // Last 14 days trend.
  const byDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    byDay.set(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), 0);
  }
  for (const a of attempts) {
    const day = (a.submittedAt as Timestamp | null)?.toDate?.().toISOString().slice(0, 10);
    if (day && byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  // Subject distribution from exams of these attempts.
  const bySubjectMap = new Map<string, number>();
  const examsList = examsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })) as WithId<import("@/types/firestore").ExamDoc>[];
  for (const a of attempts) {
    const subject = subjectOfExamSync(a.examId, examsList);
    bySubjectMap.set(subject, (bySubjectMap.get(subject) ?? 0) + 1);
  }

  // Retake analytics — approved retakes only (retakeOf != null)
  const retakeAttempts = attempts.filter((a) => a.retakeOf !== null && (a as unknown as { retakeOf?: string | null }).retakeOf !== undefined);
  const retakesTotal = retakeAttempts.length;
  const retakeRate = attempts.length ? Math.round((retakesTotal / attempts.length) * 100) : null;

  const retakesByExamMap = new Map<string, typeof retakeAttempts>();
  for (const ra of retakeAttempts) {
    const list = retakesByExamMap.get(ra.examId) ?? [];
    list.push(ra);
    retakesByExamMap.set(ra.examId, list);
  }
  const examById = new Map(examsList.map((e) => [e.id, e]));
  const retakesByExam = [...retakesByExamMap.entries()].map(([examId, list]) => {
    const exam = examById.get(examId);
    const uniqueRetakers = new Set(list.map((a) => a.studentId)).size;
    // avg improvement per retaker for this exam
    const byStudent = new Map<string, typeof list>();
    for (const a of attempts.filter((x) => x.examId === examId && x.score !== null)) {
      const s = byStudent.get(a.studentId) ?? [];
      s.push(a);
      byStudent.set(a.studentId, s);
    }
    const improvements: number[] = [];
    for (const [, arr] of byStudent) {
      if (arr.length >= 2) {
        const sorted = arr.slice().sort((x, y) => (x.createdAt as unknown as Timestamp)?.toMillis?.() ?? 0 - ((y.createdAt as unknown as Timestamp)?.toMillis?.() ?? 0));
        // fallback sort by createdAt millis
        sorted.sort((x, y) => {
          const xm = (x.createdAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
          const ym = (y.createdAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
          return xm - ym;
        });
        const first = sorted[0]!.score!.percentage;
        const last = sorted[sorted.length - 1]!.score!.percentage;
        improvements.push(last - first);
      }
    }
    const avgImprovement = improvements.length ? Math.round(improvements.reduce((n, v) => n + v, 0) / improvements.length) : null;
    return {
      examId,
      title: exam?.title ?? examId,
      subject: SUBJECT_LABELS[(exam?.params.subject as Subject) ?? "other"] ?? exam?.params.subject ?? "other",
      count: list.length,
      uniqueRetakers,
      avgImprovement,
    };
  }).sort((a, b) => b.count - a.count);

  // Per-exam detailed assessment — for each exam, compute avg score, retake count, failed/skipped rates per question
  const attemptCountsByExam = new Map<string, number>();
  for (const attempt of attempts) {
    attemptCountsByExam.set(
      attempt.examId,
      (attemptCountsByExam.get(attempt.examId) ?? 0) + 1,
    );
  }
  const examsByAttemptCount = [...examsList].sort(
    (a, b) =>
      (attemptCountsByExam.get(b.id) ?? 0) -
      (attemptCountsByExam.get(a.id) ?? 0),
  );
  const perExamDetailed = examsByAttemptCount.slice(0, 20).map((exam) => {
    const exAttempts = attempts.filter((a) => a.examId === exam.id);
    const exGraded = exAttempts.filter((a) => a.score !== null);
    const avgScore = exGraded.length ? Math.round(exGraded.reduce((n, a) => n + a.score!.percentage, 0) / exGraded.length) : null;
    const retakeCount = exAttempts.filter((a) => (a as unknown as { retakeOf?: string | null }).retakeOf !== null && (a as unknown as { retakeOf?: string | null }).retakeOf !== undefined).length;
    const failedQuestionRates = exam.questions.slice(0, 12).map((q) => {
      let fails = 0;
      let skips = 0;
      let total = 0;
      for (const att of exGraded) {
        const ans = att.answers.find((x) => x.questionId === q.id);
        if (!ans) {
          skips += 1;
          total += 1;
          continue;
        }
        const r = ans.response;
        const isSkipped = r === null || r === undefined || r === "" || (Array.isArray(r) && r.length === 0) || (Array.isArray(r) && r.every((v) => v === "" || v === null));
        if (isSkipped) skips += 1;
        else if (ans.graded && ans.graded.correct === false) fails += 1;
        else if (ans.graded && ans.graded.correct === null) {
          // essay pending — count as not failed for rate
        }
        total += 1;
      }
      return {
        questionId: q.id,
        prompt: q.prompt.slice(0, 80).replace(/[#*$_`]/g, ""),
        failRate: total ? Math.round((fails / total) * 100) : 0,
        skippedRate: total ? Math.round((skips / total) * 100) : 0,
      };
    });
    return {
      examId: exam.id,
      title: exam.title,
      subject: SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject,
      totalAttempts: exAttempts.length,
      gradedCount: exGraded.length,
      avgScore,
      retakeCount,
      failedQuestionRates,
    };
  }).sort((a, b) => b.totalAttempts - a.totalAttempts);

  return {
    studentCount: studentsSnap.size,
    examCount: examsSnap.size,
    attemptsTotal: attempts.length,
    averageScore: graded.length
      ? Math.round(graded.reduce((n, a) => n + a.score!.percentage, 0) / graded.length)
      : null,
    attemptsByDay: [...byDay.entries()].map(([date, attempts]) => ({
      date: date.slice(5),
      attempts,
    })),
    bySubject: [...bySubjectMap.entries()]
      .map(([subject, attempts]) => ({
        subject: SUBJECT_LABELS[subject as Subject] ?? subject,
        attempts,
      }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 8),
    walletBalance: walletSnap.exists ? walletSnap.data()!.balanceTokens : 0,
    tokensConsumed: walletSnap.exists ? walletSnap.data()!.totalConsumedTokens : 0,
    retakesTotal,
    retakeRate,
    retakesByExam: retakesByExam.slice(0, 10),
    perExamDetailed: perExamDetailed.slice(0, 10),
  };
}

function subjectOfExamSync(
  examId: string,
  exams: WithId<import("@/types/firestore").ExamDoc>[],
): string {
  return exams.find((e) => e.id === examId)?.params.subject ?? "other";
}

/* ─────────────────────────── Super admin ─────────────────────────── */

export interface SuperDashboardData {
  totalStudents: number;
  totalAdmins: number;
  totalSchools: number;
  totalExams: number;
  totalAttempts: number;
  activeUsers7d: number;
  revenueUsd: number;
  tokensConsumed: number;
  revenueByDay: { date: string; usd: number }[];
  attemptsBySubject: { subject: string; attempts: number }[];
  byBrowser: { browser: string; count: number }[];
  byDevice: { device: string; count: number }[];
}

export async function superDashboard(): Promise<SuperDashboardData> {
  const weekAgo = Timestamp.fromMillis(Date.now() - 7 * 86400_000);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoCutoff = oneYearAgo.toISOString().slice(0, 10);
  const [totalStudents, totalAdmins, totalSchools, totalExams, totalAttempts, activeUsers7d, metricsSnap] =
    await Promise.all([
      countQuery(usersCol().where("role", "==", "student")),
      countQuery(usersCol().where("role", "==", "admin")),
      countQuery(schoolsCol()),
      countQuery(examsCol()),
      countQuery(attemptsCol()),
      countQuery(usersCol().where("lastLoginAt", ">", weekAgo)),
      // Daily aggregates are the single source of truth for revenue and
      // consumption — no need to deserialize thousands of transaction docs.
      // Order by the `date` field (identical to the doc id, yyyy-mm-dd sorts
      // chronologically): Firestore rejects `__name__` ordering after a range
      // filter on another field.
      metricsCol().where("date", ">=", oneYearAgoCutoff).orderBy("date", "desc").limit(366).get(),
    ]);

  const metrics: WithId<DailyMetricDoc>[] = metricsSnap.docs.map((d) => ({
    id: d.id,
    ...d.data()!,
  }));

  const revenueMicros = metrics.reduce((n, m) => n + (m.usdRevenueMicros ?? 0), 0);
  const tokensConsumed = metrics.reduce((n, m) => n + (m.tokensConsumed ?? 0), 0);

  const revenueByDay = metrics
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({
      date: m.date.slice(5),
      usd: Math.round(((m.usdRevenueMicros ?? 0) / 1_000_000) * 1000) / 1000,
    }));

  const browserMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  for (const m of metrics) {
    for (const [k, v] of Object.entries(m.byBrowser ?? {})) {
      browserMap.set(k, (browserMap.get(k) ?? 0) + (v as number));
    }
    for (const [k, v] of Object.entries(m.byDevice ?? {})) {
      deviceMap.set(k, (deviceMap.get(k) ?? 0) + (v as number));
    }
  }

  // Exact per-subject exam counts via cheap count() aggregations instead of
  // deserializing every exam document.
  const subjects = Object.keys(SUBJECT_LABELS) as Subject[];
  const subjectCounts = await Promise.all(
    subjects.map(async (subject) => ({
      subject: SUBJECT_LABELS[subject],
      attempts: await countQuery(examsCol().where("params.subject", "==", subject)),
    })),
  );

  return {
    totalStudents,
    totalAdmins,
    totalSchools,
    totalExams,
    totalAttempts,
    activeUsers7d,
    revenueUsd: Math.round((revenueMicros / 1_000_000) * 100) / 100,
    tokensConsumed,
    revenueByDay,
    attemptsBySubject: subjectCounts
      .filter((s) => s.attempts > 0)
      .sort((a, b) => b.attempts - a.attempts),
    byBrowser: [...browserMap.entries()]
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count),
    byDevice: [...deviceMap.entries()]
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Record login-derived browser/device info into today's metrics. */
export async function recordLoginMetrics(
  browser: string | null,
  device: string | null,
): Promise<void> {
  if (!browser && !device) return;
  const date = new Date().toISOString().slice(0, 10);
  const update: Record<string, unknown> = {
    date,
    activeLogins: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (browser) update[`byBrowser.${browser}`] = FieldValue.increment(1);
  if (device) update[`byDevice.${device}`] = FieldValue.increment(1);
  await dailyMetricDoc(date)
    .set(update, { merge: true })
    .catch((err) => {
      console.warn("[analytics] login metrics failed", err);
    });
}
