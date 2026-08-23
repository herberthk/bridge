/**
 * Repairs FIREBASE_SERVICE_ACCOUNT_KEY in .env when it was pasted as raw
 * multi-line JSON (dotenv parsers need it single-quoted or on one line).
 * Never prints the file's contents — only structural info.
 * Run: bun scripts/fix-env-key.ts [.env]
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? ".env";
const lines = readFileSync(file, "utf8").split(/\r?\n/);

const keyIdx = lines.findIndex((l) => /^FIREBASE_SERVICE_ACCOUNT_KEY=/.test(l));
if (keyIdx === -1) {
  console.log("FIREBASE_SERVICE_ACCOUNT_KEY not found — nothing to do.");
  process.exit(0);
}

const value = lines[keyIdx]!.slice("FIREBASE_SERVICE_ACCOUNT_KEY=".length).trim();
const alreadyQuoted = value.startsWith("'") || value.startsWith('"');
const isSingleLineJson = value.startsWith("{") && value.endsWith("}");
const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(value) && !value.startsWith("{");

if (alreadyQuoted || isSingleLineJson || looksBase64) {
  console.log("FIREBASE_SERVICE_ACCOUNT_KEY already looks well-formed — no change.");
  process.exit(0);
}

// Raw (possibly truncated) multi-line paste: find where the JSON starts and
// collect through the line that closes the root object.
let jsonStart = keyIdx;
let endIdx = -1;
if (!value.startsWith("{")) {
  // The key line may hold nothing usable; the JSON begins on a later line.
  jsonStart = lines.findIndex((l, i) => i > keyIdx && l.trim().startsWith("{"));
  if (jsonStart === -1) {
    console.log(
      "Could not locate a JSON block after FIREBASE_SERVICE_ACCOUNT_KEY — paste it manually per .env.example.",
    );
    process.exit(1);
  }
}

let depth = 0;
for (let i = jsonStart; i < lines.length; i++) {
  for (const ch of lines[i]!) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }
  if (depth === 0 && lines[i]!.includes("}")) {
    endIdx = i;
    break;
  }
}
if (endIdx === -1) {
  console.log("JSON block after FIREBASE_SERVICE_ACCOUNT_KEY is incomplete — fix manually.");
  process.exit(1);
}

const jsonBlock = lines
  .slice(jsonStart, endIdx + 1)
  .join("\n")
  .trim();

// Validate before writing.
try {
  const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;
  if (!parsed.projectId || !parsed.clientEmail || !parsed.privateKey) {
    throw new Error("missing fields");
  }
} catch (err) {
  console.log(
    `The detected block is not a valid service-account JSON (${err instanceof Error ? err.message : err}) — fix manually.`,
  );
  process.exit(1);
}

// Replace: key line + the multi-line block with a single-quoted entry.
const before = lines.slice(0, Math.min(keyIdx, jsonStart));
const after = lines.slice(endIdx + 1);
const replacement = `FIREBASE_SERVICE_ACCOUNT_KEY='${jsonBlock}'`;
writeFileSync(file, [...before, replacement, ...after].join("\n"), "utf8");
console.log(
  `✅ Rewrote FIREBASE_SERVICE_ACCOUNT_KEY as a single-quoted ${jsonBlock.length.toLocaleString()}-char value (${after.length} trailing lines kept).`,
);
