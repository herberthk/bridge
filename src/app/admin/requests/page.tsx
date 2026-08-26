export const dynamic = "force-dynamic";

import { usersCol, examDoc } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import { listPendingRetakeRequests } from "@/server/services/retakes";
import { RetakeRequests } from "@/components/features/admin/retake-requests";
import { serializeDocs } from "@/lib/serialize";

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

  return (
    <RetakeRequests
      requests={serializeDocs(requests)}
      studentNames={studentNames}
      examTitles={examTitles}
    />
  );
}
