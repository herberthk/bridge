# Bridge — AI-Powered Exam Platform: Implementation Plan (final)

A production-grade Next.js app with Firebase (auth + Firestore + Storage), Gemini AI (via AI SDK v7 + @ai-sdk/google), token-based billing, AI proctoring, and three role dashboards. Confirmed decisions: manual top-up billing (gateway-ready), admin-created students, Schools + standalone admins, secret setup page for the first Super Admin, **web workers for heavy client compute**, **fully typed Firestore collections layer**, and a **premium visual design system** (gradients, layered shadows, rich animations).

## Version-critical constraints (from exploration of installed packages)

- **Next.js 16.3.2**: `proxy.ts` (NOT middleware.ts) for route protection, Node runtime only; `params`/`searchParams`/`cookies()`/`headers()` must be awaited; Turbopack is the default bundler (module workers via `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` supported); `next lint` removed (use `eslint` directly); typed helpers `PageProps<...>`/`RouteContext<...>` auto-generated.
- **AI SDK v7 / @ai-sdk/react v4**: use `instructions` (not `system`), structured output via `generateText` + `output: Output.object({ schema })` (NOT generateObject), tools via `tool({ inputSchema })`, message type is `ModelMessage`, client hook `useChat` with `transport`, voice via `useRealtime` + `google.experimental_realtime(...).getToken()` from a server route. `@ai-sdk/google` not installed yet — will add (new API name `createGoogle`). zod 4.4.3 present (v7 accepts zod 4 schemas directly).
- **Gemini models** (env-overridable defaults): `gemini-3.6-flash` for exam generation/grading, `gemini-3.1-pro-preview` optional for harder tasks, `gemini-live-2.5-flash-native-audio` for voice.

## Architecture (clean layering, `src/` structure)

```
src/
  app/                    # routes: (auth), (dashboard) w/ role segments, api/*, setup
  components/
    ui/                   # shadcn/ui components
    motion/               # reusable Framer Motion variants & primitives
    features/...          # feature components + charts
  lib/                    # firebase client, env, utils, constants (subjects/levels), pricing
  server/                 # server-only:
    firebase/admin.ts     # Admin SDK singleton
    firebase/collections.ts  # TYPED Firestore access layer
    auth/                 # session cookie, getCurrentUser() (React cache), role guards
    services/             # exams, generation, grading, billing, proctoring, users, analytics, email, pdf
    ai/                   # provider wiring, prompts, schemas, token metering
  workers/                # web workers
  stores/                 # zustand (exam session, UI)
  types/                  # shared domain types + Firestore document types
e2e/                      # Playwright (page objects, fixtures, tests)
firestore.rules, storage.rules, firebase.json, firestore.indexes.json
```

## NEW: Premium UI design system
A polished, premium look built on Tailwind v4 tokens + shadcn, with Framer Motion (already in your stack) for all motion:
- **Design language**: modern edtech aesthetic — deep indigo→violet brand gradient with teal/emerald success accents; light + dark mode (class-based). Radial mesh-gradient backgrounds with subtle noise overlay on landing/auth screens; glassy cards (backdrop-blur + translucent borders) for overlays.
- **Layered shadows** (Tailwind `@theme` custom scale): soft ambient `shadow-card`, hover-elevated `shadow-lifted`, brand-tinted `shadow-glow` (indigo halo) on primary CTAs and focused inputs; cards lift on hover with transform + shadow transitions (150–250ms, cubic-bezier ease-out).
- **Linear gradients**: gradient primary buttons + gradient text for hero/stat headings; gradient borders on premium cards (padding-trick/border-image); gradient progress bars for exam timer and scores; gradient dividers on dashboards.
- **Animations & transitions (Framer Motion)**: page/section fade-slide transitions, staggered list/card reveals, animated number counters on dashboard KPIs, chart entrance animations, dialog/sheet spring transitions, micro-interactions (button press scale, icon swaps, shimmer skeletons during AI generation with live status). Exam UI stays distraction-free but polished: calm gradient timer ring, smooth question slide/fade transitions.
- **Quality guardrails**: GPU-friendly transform/opacity animations only; every animation wrapped in reusable variants that respect `prefers-reduced-motion`; WCAG AA contrast; Vercel Web Interface Guidelines applied (focus-visible rings, 44px touch targets, optimistic UI where sensible).

## Typed Firestore collections layer (maximum type safety)
- `src/types/firestore.ts` — one exported interface per collection document: `UserDoc`, `SchoolDoc`, `WalletDoc`, `TransactionDoc`, `ExamDoc`, `AttemptDoc`, `ProctoringEventDoc`, `RetakeRequestDoc`, `AuditLogDoc`, `DailyMetricDoc`, `UploadedDocumentDoc` (+ embedded `Question`, `Answer`, `GradedFeedback`, etc.). Timestamps typed as Firestore `Timestamp`; server-set fields separated via write-types.
- `src/server/firebase/collections.ts` — `createConverter<T>()` (withConverter; strips `undefined` fields Firestore rejects) + typed accessors for every path (`usersCol()`, `examDoc(id)`, `attemptsByStudent(uid)`…). All reads/writes go through this layer → document data, fields, and paths are compile-time checked; raw `doc.data()` banned by lint convention.
- Zod schemas in `src/lib/schemas` inferred (`z.infer`) into these types — runtime validation and compile-time types share one source of truth.

## Web workers (heavy client compute off the main thread)
- `proctoring-snapshot.worker.ts` — camera frames → `OffscreenCanvas` downscale + JPEG encode → compressed blobs for Gemini analysis (keeps frame encoding off the UI thread).
- `recording.worker.ts` — mediabunny recording chunk pipelining/hashing during finalize/upload with progress accounting.
- Timer + autosave batching + violation-event queuing run in a worker loop so tab throttling can't degrade them.
- Deliberately NOT workerized: PDF/DOCX parsing (server-side), React/KaTeX rendering.

## Auth & RBAC
- Firebase Auth email/password. ID token in httpOnly cookie via `POST /api/auth/session`; server verifies with Admin SDK per request (memoized `getCurrentUser()`); client `AuthSync` refreshes cookie via `onIdTokenChanged`. `proxy.ts` = optimistic redirects only; real checks in the data layer.
- Roles in custom claims (`role`, `schoolId`): `super_admin | admin | student`; user status (active/suspended/banned) checked server-side.
- `/setup` guarded by `SETUP_ADMIN_KEY`; creates first super admin, then disables itself.

## Firestore data model
- `users/{uid}` (role, schoolId?, status, profile, lastLogin meta: IP/UA/device)
- `schools/{id}` (name, owner, counts) + `wallets/{ownerId}` (token balance) + `transactions/{id}` (ledger: topup/consumption/adjustment, tokens, USD + UGX @ 3800, balanceAfter)
- `exams/{id}` (params, questions[], sourceType, status, createdBy) + `documents/{id}` (uploads: storage path, parsed text)
- `attempts/{id}` (examId, studentId, answers, status pending→in_progress→submitted→graded|flagged, timings, autoSubmitted, score, feedback, retakeOf) + `proctoring_events/{id}` + recording Storage refs on attempt
- `retake_requests/{id}`, `audit_logs/{id}`, `metrics/daily/{date}` (aggregates for super-admin analytics)

## Key flows
1. **Exam generation (admin)**: params form (subject, level, duration, #questions, topic, difficulty, types, hints/explanations) + optional document upload (dropzone → pdf-parse / mammoth, chunked into prompt). Guard → wallet pre-check → `generateText` + `Output.object(examSchema)` → debit actual usage → save. $0.027/1k tokens.
2. **Voice config (admin)**: Gemini Live realtime token route with tool-calling tools (setSubject/setDuration/…) building a draft exam spec; $0.08/min billed to wallet.
3. **Student exam**: onboarding checklist → camera/mic/screen permissions → fullscreen distraction-free UI, server-authoritative countdown (auto-submit on lapse), copy/paste/context-menu/visibility/blur detection, mediabunny cam+screen recording, periodic Gemini analysis of worker-compressed snapshots; severity-logged violations; **two-warning flow** then auto-submit + ban from that exam + admin notified; recordings uploaded on submit.
4. **Grading**: objective auto-graded deterministically; essays via Gemini rubric → per-question + overall feedback + improvement areas; immediate results; token-metered.
5. **Retakes**: student request → admin approve → new attempt linked `retakeOf`.
6. **Reports**: @react-pdf/renderer PDFs; react-markdown + remark-math/rehype-katex for math in questions/feedback.
7. **Emails**: nodemailer + @react-email/components (invite, results, ban notices) — SMTP env vars.
8. **Dashboards**: Student (scores, subject trends, feedback); Admin (students, exams, wallet/usage, school analytics); Super Admin (platform-wide exam volume by subject/level, revenue trends, active users, devices/browsers, IP/location from login audit, school management, manual top-ups). Charts via shadcn Chart (Recharts) with animated entrances.
9. **PWA**: @serwist/next — installable, offline fallback, manifest.

## Security
Firestore + Storage rules (custom-claim based, shipped with `firebase.json`), DAL route guards, audit logging, security headers, rate limiting on AI endpoints, zod validation at every boundary.

## Build order (milestones)
1. **Foundation**: deps (`bun add`), restructure to `src/`, shadcn init + components, **design tokens (shadows/gradients palette) + Framer Motion variants library**, env + `.env.example`, domain constants, PWA base, README skeleton.
2. **Auth & RBAC**: setup page, login/logout (premium auth screens), session cookie, DAL + guards, proxy.ts, audit logs.
3. **Typed Firestore layer + users & schools**: converters + all doc types, admin creates/invites students, ban/suspend/unban, super admin manages schools/admins.
4. **Billing core**: wallets, ledger, AI-call token metering, pricing lib (UGX/USD), wallet UI, super admin top-up + provider interface stub.
5. **Exam generation**: params form, document upload/parse, AI generation, exam library, schedule/assign.
6. **Exam experience**: onboarding, proctoring rig + workers, timer, warnings, submit/auto-submit, recording upload.
7. **Grading & results**: auto-grade, AI essay grading + feedback, results views, retake flow.
8. **Reports & email**: PDF reports, email templates + nodemailer.
9. **Dashboards & analytics**: three role dashboards with animated charts, login meta capture, metrics aggregation.
10. **Voice AI**: realtime token route, voice exam-config UI with tool calling, voice billing.
11. **Hardening & tests**: rules review, Vitest units (pricing, grading, schemas, typed collections, emulator-backed services), Playwright e2e (login, exam flow, admin generation) in page-object style, docs, polish.

## Notes
- Packages via `bun add`; shadcn skill rules followed (FieldGroup/Field, semantic colors, gap-*, Chart/Badge/Empty); e2e skill page-object/testid conventions followed.
- `.env.local` gitignored; `.env.example` committed and documented (Firebase config + service account, GEMINI_API_KEY, SMTP, SETUP_ADMIN_KEY, model overrides).
- Honest scope: thorough unit tests for all pure business logic + e2e critical paths; AI outputs schema-validated and mocked in tests. Real Firebase/Gemini integration needs your keys — emulator support wired and documented.