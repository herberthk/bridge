export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeftIcon, RotateCcwIcon, TrophyIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { attemptsCol, examDoc } from "@/server/firebase/collections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUBJECT_LABELS } from "@/lib/constants";
import type { Subject } from "@/lib/constants";
import { timestampToDate } from "@/lib/serialize";
import type { AttemptDoc, ExamDoc, WithId } from "@/types/firestore";

export default async function StudentExamHistoryPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const actor = await requireRole("student");

  const examSnap = await examDoc(examId).get();
  if (!examSnap.exists) notFound();
  const exam: WithId<ExamDoc> = { id: examSnap.id, ...examSnap.data()! };

  const snap = await attemptsCol()
    .where("examId", "==", examId)
    .where("studentId", "==", actor.uid)
    .orderBy("createdAt", "asc")
    .limit(50)
    .get();

  const attempts: WithId<AttemptDoc>[] = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
  if (attempts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/student/exams" />}>
          <ArrowLeftIcon data-icon="inline-start" /> Back
        </Button>
        <p className="text-muted-foreground text-sm">No attempts for this exam yet.</p>
      </div>
    );
  }

  const graded = attempts.filter(
    (a): a is WithId<AttemptDoc> & { score: NonNullable<AttemptDoc["score"]> } =>
      a.score !== null,
  );
  const retakes = attempts.filter((a) => a.retakeOf);
  const latest = [...graded].reverse()[0];
  const first = graded[0];
  const improvement = first && latest ? latest.score.percentage - first.score.percentage : null;

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/student/exams" />}>
        <ArrowLeftIcon data-icon="inline-start" /> Back to exams
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject} · {exam.questions.length} questions · {exam.params.durationMinutes} min
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">{attempts.length} attempt{attempts.length !== 1 ? "s" : ""}</Badge>
          {retakes.length > 0 && <Badge variant="secondary">{retakes.length} retake{retakes.length !== 1 ? "s" : ""}</Badge>}
          {improvement !== null && <Badge variant={improvement >= 0 ? "secondary" : "destructive"}>{improvement > 0 ? "+" : ""}{improvement}% vs first</Badge>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrophyIcon className="size-4" /> Latest score</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{latest ? `${latest.score.percentage}%` : "—"}</p><p className="text-muted-foreground text-xs">{latest ? `${latest.score.earned}/${latest.score.possible} marks` : "Not graded"}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">First score</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{first ? `${first.score.percentage}%` : "—"}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><RotateCcwIcon className="size-4" /> Improvement</CardTitle></CardHeader><CardContent><p className={`text-2xl font-semibold ${improvement !== null && improvement > 0 ? "text-emerald-600" : improvement !== null && improvement < 0 ? "text-destructive" : ""}`}>{improvement !== null ? `${improvement > 0 ? "+" : ""}${improvement}%` : "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Retake history & per-attempt detailed assessment</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[...attempts].reverse().map((a) => {
            const isRetake = !!a.retakeOf;
            const failed = a.answers.filter((x) => x.graded?.correct === false).length;
            const skipped = a.answers.filter((x) => !x.response || x.response === "" || (Array.isArray(x.response) && x.response.length === 0)).length;
            const parsedSubmittedAt = timestampToDate(a.submittedAt);
            const parsedCreatedAt = timestampToDate(a.createdAt);
            const submittedAt = parsedSubmittedAt && !Number.isNaN(parsedSubmittedAt.getTime())
              ? parsedSubmittedAt
              : null;
            const createdAt = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
              ? parsedCreatedAt
              : null;
            const improvementTip = a.feedback?.improvements[0];
            return (
              <div key={a.id} className={`rounded-xl border p-4 ${isRetake ? "bg-amber-500/5 border-amber-500/20" : "bg-card"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      {isRetake && <Badge variant="outline" className="border-amber-500/30 text-amber-700">Retake</Badge>}
                      Attempt {a.id.slice(0, 6)} · {a.status}
                      {a.score ? ` · ${a.score.percentage}%` : ""}
                    </p>
                    <p className="text-muted-foreground text-xs">{submittedAt ? format(submittedAt, "d MMM yyyy HH:mm") : createdAt ? format(createdAt, "d MMM yyyy") : "—"} · {a.timeSpentSeconds ? `${Math.round(a.timeSpentSeconds/60)} min` : "—"}</p>
                  </div>
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/student/results/${a.id}`} />}>View assessment</Button>
                </div>
                {a.score && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-emerald-500/10 p-2"><p className="font-semibold text-emerald-700">{(a.answers?.length ?? 0) - failed - skipped} correct</p></div>
                    <div className="rounded-lg bg-destructive/5 p-2"><p className="font-semibold text-destructive">{failed} failed</p></div>
                    <div className="rounded-lg bg-amber-500/10 p-2"><p className="font-semibold text-amber-700">{skipped} skipped</p></div>
                  </div>
                )}
                {improvementTip && (
                  <p className="text-muted-foreground mt-2 text-xs"><span className="font-medium">Tip to 100%:</span> {improvementTip}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
