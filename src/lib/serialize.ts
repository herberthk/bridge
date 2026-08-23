import type { FirestoreTimestamp, WithId } from "@/types/firestore";

/**
 * Timestamps → ISO strings for the Server→Client component boundary.
 * React's serializer only accepts plain objects; Firestore Timestamps are
 * class instances, so every doc passed to a Client Component must go
 * through `serializeDoc` first. Client code reads them with `parseDate`.
 */

/** Non-distributive so `Score | null` (no timestamps) passes through intact. */
type MaybeTs<T> = [T] extends [FirestoreTimestamp]
  ? string
  : [T] extends [FirestoreTimestamp | null]
    ? string | null
    : T;

export type Serialized<T> = { [K in keyof T]: MaybeTs<T[K]> };
export type SerializedWithId<T> = WithId<Serialized<T>>;

function isTimestampLike(value: unknown): value is FirestoreTimestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  );
}

function convert(value: unknown): unknown {
  if (isTimestampLike(value)) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return out;
  }
  return value;
}

/** Serialize one document (id + fields) for Client Component props. */
export function serializeDoc<T extends object>(doc: WithId<T>): SerializedWithId<T> {
  return convert(doc) as SerializedWithId<T>;
}

export function serializeDocs<T extends object>(docs: WithId<T>[]): SerializedWithId<T>[] {
  return docs.map(serializeDoc);
}

/** Client-side: ISO string (or null) → Date for date-fns/format. */
export function parseDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
