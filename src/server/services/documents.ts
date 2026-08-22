import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminStorage } from "@/server/firebase/admin";
import { sourceDocumentDoc, sourceDocumentsCol } from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, UploadedDocumentDoc, WriteModel } from "@/types/firestore";

export class DocumentsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export interface ParsedUpload {
  doc: WithId<UploadedDocumentDoc>;
}

/** Accept an uploaded file, extract text, persist to Storage + Firestore. */
export async function uploadAndParseDocument(
  actor: SessionUser,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<ParsedUpload> {
  if (!ALLOWED_TYPES.has(file.mimeType)) {
    throw new DocumentsServiceError(
      "Unsupported file type — upload PDF, DOCX, or TXT.",
      415,
    );
  }
  if (file.buffer.byteLength > MAX_BYTES) {
    throw new DocumentsServiceError("File too large (max 50 MB).", 413);
  }

  const { text, pageCount } = await extractText(file.buffer, file.mimeType);

  const storagePath = `docs/${actor.uid}/${Date.now()}-${sanitize(file.name)}`;
  const bucket = adminStorage().bucket();
  await bucket.file(storagePath).save(file.buffer, {
    metadata: { contentType: file.mimeType },
  });

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<UploadedDocumentDoc> = {
    ownerId: actor.uid,
    schoolId: actor.schoolId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.buffer.byteLength,
    storagePath,
    parseStatus: text ? "parsed" : "failed",
    parsedText: text || null,
    pageCount,
    createdAt: now,
  };
  const ref = await sourceDocumentsCol().add(doc);
  return {
    doc: {
      id: ref.id,
      ...(doc as UploadedDocumentDoc),
      createdAt: Timestamp.now(),
    },
  };
}

async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; pageCount: number | null }> {
  try {
    if (mimeType === "application/pdf") {
      // pdf-parse v2: class API — always destroy to free the worker.
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return { text: result.text ?? "", pageCount: result.pages?.length ?? null };
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value ?? "", pageCount: null };
    }
    return { text: buffer.toString("utf8"), pageCount: null };
  } catch (err) {
    console.error("[documents] extract failed", err);
    return { text: "", pageCount: null };
  }
}

/** Load parsed text for a set of documents owned by the actor. */
export async function loadDocumentExcerpts(
  actor: SessionUser,
  documentIds: string[],
): Promise<{ name: string; text: string }[]> {
  const docs = await Promise.all(
    documentIds.map(async (id) => {
      const snap = await sourceDocumentDoc(id).get();
      if (!snap.exists) return null;
      const doc = snap.data()!;
      if (doc.ownerId !== actor.uid && actor.role !== "super_admin") return null;
      if (!doc.parsedText) return null;
      return { name: doc.name, text: doc.parsedText };
    }),
  );
  return docs.filter((d): d is { name: string; text: string } => d !== null);
}

export async function listDocuments(actor: SessionUser): Promise<WithId<UploadedDocumentDoc>[]> {
  const snap = await sourceDocumentsCol()
    .where("ownerId", "==", actor.uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
}
