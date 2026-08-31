import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminStorage } from "@/server/firebase/admin";
import { sourceDocumentDoc, sourceDocumentsCol } from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, UploadedDocumentDoc, WriteModel } from "@/types/firestore";
import { vertex } from "@/lib/vertext";

export class DocumentsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
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
      "Unsupported file type — upload PDF, scanned documents/images (JPG, PNG, WEBP), DOCX, or TXT.",
      415,
    );
  }
  if (file.buffer.byteLength > MAX_BYTES) {
    throw new DocumentsServiceError("File too large (max 10 MB).", 413);
  }

  const { text, pageCount } = await extractText(file.buffer, file.mimeType);

  const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${sanitize(file.name)}`;
  const storagePath = `docs/${actor.uid}/${uniqueSuffix}`;
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    throw new DocumentsServiceError(
      "Storage is not configured — NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is missing.",
      500,
    );
  }
  const bucket = adminStorage().bucket(bucketName);
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
      let parsedText = "";
      let pagesCount: number | null = null;
      try {
        const result = await parser.getText();
        parsedText = (result.text ?? "").trim();
        pagesCount = result.pages?.length ?? null;
      } finally {
        await parser.destroy().catch(() => undefined);
      }

      // If PDF had text extracted directly, return it
      if (parsedText.length > 20) {
        return { text: parsedText, pageCount: pagesCount };
      }

      // If text layer is sparse/empty (scanned PDF), use Gemini multimodal OCR
      try {
        const { generateText } = await import("ai");
        const { text } = await generateText({
        model: vertex("gemini-3.1-flash-lite"),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract and transcribe all questions, instructions, text, formulas, and content from this scanned document PDF completely and cleanly.",
                },
                {
                  type: "file",
                  data: buffer,
                  mediaType: "application/pdf",
                },
              ],
            },
          ],
        });
        return { text: text.trim() || parsedText, pageCount: pagesCount };
      } catch (ocrErr) {
        console.warn("[documents] PDF OCR fallback failed", ocrErr);
        return { text: parsedText, pageCount: pagesCount };
      }
    }

    if (mimeType.startsWith("image/")) {
      // Scanned document image (JPEG, PNG, WEBP)
      const { generateText } = await import("ai");
      const { text } = await generateText({
        model: vertex("gemini-3.1-flash-lite"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract and transcribe all questions, instructions, text, formulas, and content from this scanned document image completely and cleanly.",
              },
              {
                type: "file",
                data: buffer,
                mediaType: mimeType,
              },
            ],
          },
        ],
      });
      return { text: text.trim(), pageCount: 1 };
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
    .limit(10)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
}
