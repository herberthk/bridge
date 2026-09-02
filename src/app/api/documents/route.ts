import { NextResponse, type NextRequest } from "next/server";

import { apiUser } from "@/server/auth/session";
import {
  uploadAndParseDocument,
  DocumentsServiceError,
} from "@/server/services/documents";

const MAX_BYTES = 10 * 1024 * 1024;

/** Upload a source document (PDF, scanned images, DOCX, TXT) for AI-grounded generation. */
export async function POST(request: NextRequest) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { doc } = await uploadAndParseDocument(actor, {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });
    return NextResponse.json({
      ok: true,
      documentId: doc.id,
      name: doc.name,
      parseStatus: doc.parseStatus,
      pageCount: doc.pageCount,
    });
  } catch (err) {
    const status = err instanceof DocumentsServiceError ? err.status : 500;
    const message =
      err instanceof DocumentsServiceError ? err.message : "Upload failed.";
    if (status >= 500) {
      console.error("[documents] upload error:", err);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
