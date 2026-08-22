import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  attemptsCol,
  dailyMetricDoc,
  examsCol,
  metricsCol,
  schoolsCol,
  transactionsCol,
  usersCol,
  walletsCol,
} from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, AttemptDoc, DailyMetricDoc } from "@/types/firestore";
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
  for (const a of attempts) {
    const subject = subjectOfExamSync(a.examId, examsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })));
    bySubjectMap.set(subject, (bySubjectMap.get(subject) ?? 0) + 1);
  }

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
  const [studentsSnap, adminsSnap, schoolsSnap, examsSnap, attemptsSnap, metricsSnap, txSnap, loginsSnap] =
    await Promise.all([
      usersCol().where("role", "==", "student").get(),
      usersCol().where("role", "==", "admin").get(),
      schoolsCol().get(),
      examsCol().limit(5000).get(),
      attemptsCol().limit(5000).get(),
      metricsCol().orderBy("__name__", "desc").limit(30).get(),
      transactionsCol().where("type", "==", "consumption").limit(5000).get(),
      usersCol().where("lastLoginAt", ">", Timestamp.fromMillis(Date.now() - 7 * 86400_000)).get(),
    ]);

  const metrics: WithId<DailyMetricDoc>[] = metricsSnap.docs.map((d) => ({
    id: d.id,
    ...d.data()!,
  }));

  // Revenue = all consumption transactions.
  const revenueMicros = txSnap.docs.reduce(
    (n, d) => n + (d.data()!.usdMicros ?? 0),
    0,
  );
  const tokensConsumed = metrics.reduce((n, m) => n + (m.tokensConsumed ?? 0), 0);

  const revenueByDay = metrics
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({
      date: m.date.slice(5),
      usd: Math.round(((m.usdRevenueMicros ?? 0) / 1_000_000) * 1000) / 1000,
    }));

  // Subject distribution across all exams' attempts.
  const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data()! }));
  const subjectCount = new Map<string, number>();
  for (const e of exams) {
    const s = SUBJECT_LABELS[e.params.subject as Subject] ?? e.params.subject;
    subjectCount.set(s, (subjectCount.get(s) ?? 0) + 1);
  }

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

  return {
    totalStudents: studentsSnap.size,
    totalAdmins: adminsSnap.size,
    totalSchools: schoolsSnap.size,
    totalExams: examsSnap.size,
    totalAttempts: attemptsSnap.size,
    activeUsers7d: loginsSnap.size,
    revenueUsd: Math.round((revenueMicros / 1_000_000) * 100) / 100,
    tokensConsumed,
    revenueByDay,
    attemptsBySubject: [...subjectCount.entries()]
      .map(([subject, attempts]) => ({ subject, attempts }))
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
