import type { Metadata } from "next";

import { usersCol, examDoc } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import {
  listPendingRetakeRequests,
  listRetakeDecisionHistory,
  type RetakeDecisionEntry,
} from "@/server/services/retakes";
import { RetakeRequests } from "@/components/features/admin/retake-requests";
import { serializeDocs } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Retake Requests | Bridge Admin",
  description: "Review student retake requests and audit past decisions.",
};

export default async function AdminRequestsPage() {
  const actor = await requireRole("admin");

  let requests: Awaited<ReturnType<typeof listPendingRetakeRequests>> = [];
  try {
    requests = await listPendingRetakeRequests(actor);
  } catch (err) {
    console.error("[admin/requests] load failed", err);
  }

  // Resolve display names/titles for the request list. Chunked `in` queries
  // so lists beyond 30 requests still resolve names.
  const studentIds = [...new Set(requests.map((r) => r.studentId))];
  const examIds = [...new Set(requests.map((r) => r.examId))];
  const CHUNK = 30;
  const studentNamesArr = await Promise.all(
    Array.from({ length: Math.ceil(studentIds.length / CHUNK) }, (_, i) =>
      usersCol()
        .where("__name__", "in", studentIds.slice(i * CHUNK, (i + 1) * CHUNK))
        .get()
        .catch(() => null),
    ),
  );
  const examTitlesArr = await Promise.all(
    examIds.map((id) => examDoc(id).get().catch(() => null)),
  );

  const studentNames: Record<string, string> = {};
  studentNamesArr.forEach((snap) =>
    snap?.forEach((d) => {
      studentNames[d.id] = d.data().displayName;
    }),
  );
  const examTitles: Record<string, string> = {};
  examTitlesArr.forEach((snap, i) => {
    if (snap?.exists) examTitles[examIds[i]] = snap.data()!.title;
  });

  // Decision history: who approved/rejected/granted what, and when.
  let history: RetakeDecisionEntry[] = [];
  try {
    history = await listRetakeDecisionHistory(actor);
  } catch (err) {
    console.error("[admin/requests] history load failed", err);
  }
  const historyStudentIds = [...new Set(history.map((h) => h.studentId))];
  const deciderIds = [
    ...new Set(history.map((h) => h.decidedBy).filter((v): v is string => Boolean(v))),
  ];
  const historyExamIds = [...new Set(history.map((h) => h.examId))];
  const nameChunks = (ids: string[]) =>
    Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
      usersCol()
        .where("__name__", "in", ids.slice(i * CHUNK, (i + 1) * CHUNK))
        .get()
        .catch(() => null),
    );
  const [historyStudentArr, deciderArr, historyExamArr] = await Promise.all([
    Promise.all(nameChunks(historyStudentIds)),
    Promise.all(nameChunks(deciderIds)),
    Promise.all(historyExamIds.map((id) => examDoc(id).get().catch(() => null))),
  ]);
  historyStudentArr.forEach((snap) =>
    snap?.forEach((d) => {
      studentNames[d.id] = d.data().displayName;
    }),
  );
  const deciderNames: Record<string, string> = {};
  deciderArr.forEach((snap) =>
    snap?.forEach((d) => {
      deciderNames[d.id] = d.data().displayName;
    }),
  );
  const historyExamTitles: Record<string, string> = {};
  historyExamArr.forEach((snap, i) => {
    if (snap?.exists) historyExamTitles[historyExamIds[i]] = snap.data()!.title;
  });

  return (
    <RetakeRequests
      requests={serializeDocs(requests)}
      studentNames={studentNames}
      examTitles={examTitles}
      history={serializeDocs(history)}
      deciderNames={deciderNames}
      historyExamTitles={historyExamTitles}
      viewerUid={actor.uid}
    />
  );
}
