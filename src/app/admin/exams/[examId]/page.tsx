export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, RotateCcwIcon, TrophyIcon, UsersIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getExamForActor } from "@/server/services/exams";
import { attemptsCol } from "@/server/firebase/collections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUBJECT_LABELS } from "@/lib/constants";
import type { Subject } from "@/lib/constants";
import type { AttemptDoc, WithId } from "@/types/firestore";

export default async function AdminExamDetailPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const actor = await requireRole("admin");

  let exam: Awaited<ReturnType<typeof getExamForActor>> | null = null;
  try {
    exam = await getExamForActor(actor, examId);
  } catch {
    notFound();
  }
  if (!exam) notFound();

  // Fetch attempts for this exam scoped to school
  const snap = await attemptsCol()
    .where("examId", "==", examId)
    .where("schoolId", "==", actor.schoolId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get()
    .catch(async () => {
      // Fallback if schoolId filter fails for standalone admins
      return attemptsCol().where("examId", "==", examId).limit(100).get();
    });

  const attempts: WithId<AttemptDoc>[] = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
  const graded = attempts.filter((a) => a.score !== null);
  const retakes = attempts.filter((a) => a.retakeOf);
  const avgScore = graded.length
    ? Math.round(
        graded.reduce((n, a) => n + (a.score?.percentage ?? 0), 0) /
          graded.length,
      )
    : null;

  // Group by student for improvement
  const byStudent = new Map<string, WithId<AttemptDoc>[]>();
  for (const a of attempts) {
    const list = byStudent.get(a.studentId) ?? [];
    list.push(a);
    byStudent.set(a.studentId, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/exams" />}>
        <ArrowLeftIcon data-icon="inline-start" /> Back to library
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject} · {exam.params.level === "primary" ? `P${exam.params.classLevel}` : `S${exam.params.classLevel}`} · {exam.questions.length} questions · {exam.params.durationMinutes} min
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">{exam.status}</Badge>
          <Badge variant="secondary">{attempts.length} attempts</Badge>
          <Badge variant="secondary">{retakes.length} retakes</Badge>
          {avgScore !== null && <Badge variant="secondary">Avg {avgScore}%</Badge>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><UsersIcon className="size-4" /> Students attempted</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{byStudent.size}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><RotateCcwIcon className="size-4" /> Retakes</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{retakes.length}</p><p className="text-muted-foreground text-xs">{retakes.length ? `${new Set(retakes.map((a) => a.studentId)).size} students retook` : "No retakes"}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrophyIcon className="size-4" /> Avg score</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{avgScore !== null ? `${avgScore}%` : "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Attempts per student — retake history & improvement</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 border-y text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Attempts</th><th className="px-3 py-2 text-right">First</th><th className="px-3 py-2 text-right">Latest</th><th className="px-3 py-2 text-right">Delta</th><th className="px-3 py-2 text-right">Retakes</th></tr>
            </thead>
            <tbody className="divide-y">
              {[...byStudent.entries()].slice(0, 50).map(([studentId, list]) => {
                const sorted = [...list].sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
                const first = sorted.find((a) => a.score)?.score?.percentage ?? null;
                const latest = [...sorted].reverse().find((a) => a.score)?.score?.percentage ?? null;
                const delta = first !== null && latest !== null ? latest - first : null;
                const retakeCount = sorted.filter((a) => a.retakeOf).length;
                return (
                  <tr key={studentId} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs truncate max-w-32">{studentId.slice(0, 8)}…</td>
                    <td className="px-3 py-2.5">{sorted.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{first !== null ? `${first}%` : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{latest !== null ? `${latest}%` : "—"}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${delta !== null && delta > 0 ? "text-emerald-600" : delta !== null && delta < 0 ? "text-destructive" : ""}`}>{delta !== null ? `${delta > 0 ? "+" : ""}${delta}%` : "—"}</td>
                    <td className="px-3 py-2.5 text-right">{retakeCount}</td>
                  </tr>
                );
              })}
              {byStudent.size === 0 && <tr><td colSpan={6} className="text-muted-foreground px-4 py-8 text-center text-sm">No attempts yet</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Per-question fail / skip rates — detailed assessment</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {exam.questions.slice(0, 20).map((q) => {
            let fails = 0, skips = 0, total = 0;
            for (const att of graded) {
              const ans = att.answers.find((x) => x.questionId === q.id);
              const isSkipped = !ans || ans.response === null || ans.response === "" || (Array.isArray(ans.response) && ans.response.length === 0);
              if (isSkipped) skips++; else if (ans?.graded?.correct === false) fails++;
              total++;
            }
            const failRate = total ? Math.round((fails / total) * 100) : 0;
            const skipRate = total ? Math.round((skips / total) * 100) : 0;
            return (
              <div key={q.id} className="rounded-xl border p-3">
                <p className="text-sm font-medium line-clamp-2">{q.prompt.replace(/[#*$_`]/g, "").slice(0, 140)}</p>
                <div className="mt-2 flex gap-2 text-xs">
                  <Badge variant="outline" className="text-destructive border-destructive/20">{failRate}% failed</Badge>
                  <Badge variant="outline" className="border-amber-500/20 text-amber-700">{skipRate}% skipped</Badge>
                  <span className="text-muted-foreground ml-auto">{q.points} pts · {q.type.replace(/_/g, " ")}</span>
                </div>
                {failRate > 40 && <p className="text-muted-foreground mt-1.5 text-xs">Suggestion: Many students failed — review this concept in class; consider a remedial exercise.</p>}
                {skipRate > 30 && <p className="text-muted-foreground mt-1 text-xs">Suggestion: High skip rate — question may be unclear or time-pressured.</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
