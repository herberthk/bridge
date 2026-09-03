# Bridge — AI-Powered Assessment Platform

Bridge generates, proctors, and grades AI-powered exams for primary and
secondary school students (Ugandan curriculum first, expandable to other
countries), with instant personalized feedback and rich analytics for
teachers and platform administrators.

## Highlights

- **Self-serve school setup** — join as a normal user, create your school
  (primary **or** secondary — an exclusive choice that drives the standard
  class set: P1–P7 or S1–S6), and become its admin through a guided wizard.
- **Classes & teachers** — class entities with rosters and dashboards;
  teachers join via emailed, single-use invite links and manage the classes
  assigned to them (admins can create/assign classes and revoke invites).
- **AI exam generation** — configure subject, level, topic, duration,
  difficulty, question count, and question types; set a deadline/expiry, or
  upload past papers, textbooks, and notes (PDF/DOCX) as source material.
- **Class dashboards & leaderboards** — per-class roster, ranked performance
  leaderboard (average + best score + trend), per-exam analytics, and
  one-click exam generation/assignment from the class page.
- **Retakes, two ways** — students request retakes as before, or staff grant
  one directly from results.
- **School verification (blue tick)** — schools add their registration
  details and request verification; a Super Admin grants the blue tick.
- **Voice-configured exams** — converse with a Gemini Live assistant that
  builds the exam spec through tool calling.
- **AI-proctored exam sessions** — fullscreen distraction-free UI,
  server-authoritative timer, camera/microphone/screen recording
  (mediabunny), copy-paste and tab-switch detection, periodic AI snapshot
  analysis, and a fair two-warning anti-cheating policy.
- **Automatic grading & feedback** — objective questions scored instantly;
  essays graded against rubrics with per-question feedback and recommended
  improvement areas.
- **Five roles** — Super Admin (platform analytics, schools, verification,
  billing), Admin (school owner), Teacher (assigned classes), Student (take
  exams, view results, request retakes), Member (signed-up user who has not
  created a school yet).
- **Pay-as-you-go billing** — token wallets per school/admin with self-serve
  top-up checkout (a simulated gateway today; real providers plug into the
  same `PaymentProvider` seam later): `$0.027 / 1,000 text tokens`,
  `$0.08 / voice minute`, `1 USD = 3,800 UGX`.
- **Premium UI** — Tailwind v4 + shadcn/ui (Base UI primitives) with
  gradient/mesh backgrounds, layered shadows, and Framer Motion animations
  that respect `prefers-reduced-motion`.

## Tech stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 ·
shadcn/ui · Framer Motion (`motion`) · Firebase (Auth, Firestore, Storage,
Security Rules) · Vercel AI SDK v7 + `@ai-sdk/google` (Gemini) · zustand ·
zod · react-hook-form · react-markdown + KaTeX · mediabunny ·
@react-pdf/renderer · @react-email + nodemailer · @serwist/next (PWA) ·
Vitest (unit) · Playwright (e2e).

## Getting started

```bash
bun install
cp .env.example .env.local   # fill in Firebase + Gemini keys
bun run dev                  # http://localhost:3000
```

Required environment variables are documented in [`.env.example`](./.env.example):

- Firebase web config (`NEXT_PUBLIC_FIREBASE_*`) and a service-account key
  for the Admin SDK (`FIREBASE_SERVICE_ACCOUNT_KEY`).
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini API key.
- `SETUP_ADMIN_KEY` — secret for the one-time `/setup` page that creates
  the first Super Admin.
- SMTP settings for email notifications.

### Local emulators (optional)

```bash
npx -y firebase-tools@latest emulators:start
# then set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true in .env.local
```

### First-run bootstrap

1. Visit `/signup` to join as a normal user, then follow the onboarding
   wizard to create your school (you become its admin).
2. Or visit `/setup` and paste your `SETUP_ADMIN_KEY` to create the Super
   Admin account, then create schools and admins from `/super/schools`.
3. Invite teachers (email link), add students to classes, and generate your
   first exam from a class dashboard.

### Migrating pre-existing data

Before deploying the optimized super-admin directory and retake-history queries,
backfill their normalized names and provenance fields:

```bash
bun --env-file=.env.local scripts/backfill-directory-retake-fields.ts
```

After pulling this architecture, run once against an existing dev project:

```bash
bun --env-file=.env.local scripts/migrate-school-architecture.ts
```

It backfills school `level`/verification fields, creates the standard class
set per school, assigns existing students to matching classes, and seeds
`expiresAt` on old exams. It is idempotent.

## Scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Start the dev server |
| `bun run build` | Production build + service worker |
| `bun run start` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | TypeScript, no emit |
| `bun run test` | Vitest unit tests |
| `bun run e2e` | Playwright end-to-end tests |

## Project structure

```
src/
  app/          # routes (auth, dashboards, exam runner, api handlers)
  components/   # ui/ (shadcn), motion/ (Framer Motion), feature components
  lib/          # client-safe: firebase, constants, schemas, utils, pricing
  server/       # server-only: admin SDK, typed Firestore layer, services, AI
  stores/       # zustand stores
  types/        # shared domain + Firestore document types
  workers/      # web workers (proctoring snapshots, recording pipeline)
e2e/            # Playwright page objects, fixtures, tests
```

Architecture follows clean layering: UI → server services (auth guards,
billing, AI) → typed Firestore access layer. All document access goes
through converters in `src/server/firebase/collections.ts` for compile-time
type safety.

## Security

- Role-based access via Firebase custom claims, enforced in Firestore/
  Storage rules **and** the server data-access layer.
- Session ID tokens delivered as httpOnly cookies, verified per request
  with the Admin SDK.
- Audit logging for sensitive actions; rate limiting on AI endpoints.
- `proxy.ts` performs optimistic redirects; authoritative checks always
  happen server-side next to the data.

## Testing

- **Unit (Vitest)** — pricing/billing math, grading logic, zod schemas,
  proctoring policy, typed collection helpers.
- **E2E (Playwright)** — critical paths: setup/login, student exam flow
  (with fake media streams), admin generation. Page-object pattern lives
  in `e2e/pages`.

## Deployment

Any Node 22+ host or Vercel. Set the same environment variables; the
service worker is built automatically during `bun run build`.
