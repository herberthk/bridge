<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Bridge frontend — agent notes

Single-package Next.js 16 App Router app (`bun@1.4.0`). Path alias `@/*` → `src/*` (tsconfig + vitest alias). No monorepo, no CI workflows, no `opencode.json`.

## Commands (use bun, not npm)

```bash
bun install
bun run dev          # Turbopack; never builds the service worker
bun run build        # next build && serwist build — never run serwist alone
bun run lint && bun run typecheck && bun run test
bunx vitest run tests/unit/<name>.test.ts   # single suite (include: tests/unit/**/*.test.ts)
bun run e2e
bun run firebase-deploy  # only firestore:rules, firestore:indexes, storage
bun scripts/<name>.ts    # backfill-directory-retake-fields is idempotent
```

Playwright auto-starts `bun run dev` on `http://127.0.0.1:3000` unless `E2E_NO_SERVER=1`. Only `e2e/tests/smoke,console` run without a backend; full auth/exam flows need `E2E_HAS_BACKEND=1` + seeded Firebase/emulators.

## Auth — the split that matters

- `src/proxy.ts` (not `middleware.ts`) does optimistic cookie-presence redirects only. No I/O, no role checks.
- Authoritative checks live in `src/server/auth/session.ts`: `getCurrentUser()` (React `cache` + `verifySessionCookie` on `bridge-session` httpOnly cookie), `requireUser / requireActiveUser / requireRole` for RSC (redirect), `apiUser(...roles)` for route handlers (returns null, never redirect). Status checked before role (`banned` → `/banned`).
- Identity = Firebase custom claims (`role` + `schoolId`) + `users/{uid}` doc. `roleHome()` maps role → `/super|/admin|/teacher|/student|/onboarding`.

## Data layer rules

- Never call `.collection()` / `.doc()` directly. Use typed accessors in `src/server/firebase/collections.ts` (converters + `stripUndefined` — Firestore rejects `undefined`).
- Firestore rejects nested arrays: question-table rows are `{ cells: string[] }[]`, never `string[][]`.
- `ExamReview` timestamps are ISO strings deliberately (`Serialized<T>` only converts top-level `Timestamp`s).
- `src/server/*` files must keep `import "server-only"`. `pdf-parse`, `mammoth`, `firebase-admin`, `@react-pdf/renderer` must stay in `serverExternalPackages` in `next.config.ts`.
- Security rules are deny-by-default: clients may only mark own notifications read and edit own `displayName/photoURL`. All other mutations go through Admin SDK route handlers. Storage layouts: `recordings/{uid}/{attemptId}/` (preferred, no Firestore lookup) + legacy `recordings/{attemptId}/`, `docs/{ownerId}/`, `avatars/{uid}/` — content-type/size enforced in `storage.rules`.

## AI + billing gotchas

- Two providers: `src/server/ai/provider.ts` (API key `GOOGLE_GENERATIVE_AI_API_KEY`, models `BRIDGE_MODEL_TEXT/_PRO/_LIVE`) vs `src/lib/vertext.ts` (Vertex `GOOGLE_CLIENT_EMAIL/_PRIVATE_KEY/_PROJECT/_LOCATION`). Exams + grading call `vertex()`.
- `thinkingOptions(modelId)` branches: gemini-3.x → `thinkingLevel: "low"` (flash rejects `minimal`/off), 2.5 → `thinkingBudget: 0`. Don't unify.
- Generation calls require `structuredOutputs: false` + client-side `Output.object` validation — grammar-constrained decoding causes repetition loops on long fields (documented in `exams.ts`).
- `planGeneration()` in `src/server/services/exams.ts` is pure and must stay pure (unit-tested). Budget `150s`, save reserve `12s`; route `maxDuration = 180` needs matching host timeout (Vercel Hobby caps at 60s; App Hosting needs `runConfig.timeoutSeconds`).
- Billing is integer micro-dollars (`src/lib/pricing.ts`). Wallet id = `schoolId ?? uid`. Pre-flight reserves: generation `3×`, revision `4×` — wizard quote and `assertCanAfford` must use the same helper or admins hit spurious 402s. Debits/credits are Firestore transactions appending to `transactions`.

## Env + emulators

`.env.local` is gitignored; copy `.env.example`. `FIREBASE_SERVICE_ACCOUNT_KEY` accepts quoted-multiline, single-line, or base64 (raw multiline paste fails); fallback is `FIREBASE_PROJECT_ID/_CLIENT_EMAIL/_PRIVATE_KEY`. `INTERNAL_API_SECRET` guards `/api/internal/*` via `x-internal-secret`. Emulators: `npx -y firebase-tools@latest emulators:start` (auth 9099, firestore 8080, storage 9199, UI 4000) + `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`. `public/sw*` is a build artifact (gitignored).

## Conventions

- Services in `src/server/services/` own one domain each; route handlers only parse (zod in `src/lib/schemas/`) + call `apiUser` + delegate. Exam submit/proctor paths use transactions so termination beats a racing submit.
- Client exam state is the non-persisted zustand `useExamSession` (one attempt per mount); clock + snapshot work lives in `src/workers/`.
- shadcn `base-nova`, CSS `src/app/globals.css`, icons `lucide` (`components.json`). Feature UI in `src/components/features/{admin,teacher,student,super,school,exam,auth,notifications,dashboard}`.
