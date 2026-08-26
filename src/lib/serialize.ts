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

/**
 * Convert any plausible timestamp representation to a `Date`. Accepts
 * Firestore Timestamps (and their serialized `{ seconds }` form), JS Dates,
 * ISO strings, and epoch millis/seconds numbers. Returns null for missing or
 * unparseable values so callers can fall back instead of crashing — guards
 * against legacy documents that store timestamps as strings/numbers.
 */
export function timestampToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object") {
    const ts = value as Partial<FirestoreTimestamp>;
    if (typeof ts.toDate === "function") {
      try {
        return ts.toDate();
      } catch {
        return null;
      }
    }
    if (typeof ts.seconds === "number") {
      return new Date(ts.seconds * 1000);
    }
    return null;
  }
  if (typeof value === "string") return parseDate(value);
  if (typeof value === "number") {
    // Epoch seconds (< 1e11) vs epoch millis.
    return new Date(value < 1e11 ? value * 1000 : value);
  }
  return null;
}

/** Client-side: ISO string (or null) → Date for date-fns/format.
 *  Returns null for missing OR unparseable values so callers can fall back
 *  instead of crashing date-fns `format` with an Invalid Date. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
