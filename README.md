# Bridge — AI-Powered Assessment Platform

Bridge generates, proctors, and grades AI-powered exams for primary and
secondary school students (Ugandan curriculum first, expandable to other
countries), with instant personalized feedback and rich analytics for
teachers and platform administrators.

## Highlights

- **AI exam generation** — configure subject, level, topic, duration,
  difficulty, question count, and question types; or upload past papers,
  textbooks, and notes (PDF/DOCX) as source material.
- **Voice-configured exams** — converse with a Gemini Live assistant that
  builds the exam spec through tool calling.
- **AI-proctored exam sessions** — fullscreen distraction-free UI,
  server-authoritative timer, camera/microphone/screen recording
  (mediabunny), copy-paste and tab-switch detection, periodic AI snapshot
  analysis, and a fair two-warning anti-cheating policy.
- **Automatic grading & feedback** — objective questions scored instantly;
  essays graded against rubrics with per-question feedback and recommended
  improvement areas.
- **Three roles** — Super Admin (platform analytics, schools, billing),
  Admin (school/teacher/parent: generate, schedule, monitor, authorize
  retakes, ban/unban), Student (take exams, view results, request retakes).
- **Pay-as-you-go billing** — token wallets per admin:
  `$0.027 / 1,000 text tokens`, `$0.08 / voice minute`, `1 USD = 3,800 UGX`.
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

1. Visit `/setup` and paste your `SETUP_ADMIN_KEY`.
2. Create the Super Admin account.
3. Sign in, create a school (or act as a standalone parent/tutor admin),
   then invite or create students.

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
