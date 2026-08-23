import Link from "next/link";
import {
  AudioLinesIcon,
  BarChart3Icon,
  BrainIcon,
  ScanEyeIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AnimatedCounter,
  FadeIn,
  Stagger,
  StaggerItem,
} from "@/components/motion";
import { SUBJECT_LABELS } from "@/lib/constants";

const features = [
  {
    icon: BrainIcon,
    title: "AI exam generation",
    description:
      "Describe the subject, topic, and difficulty — or upload past papers and notes — and Gemini crafts a full exam in seconds.",
  },
  {
    icon: ScanEyeIcon,
    title: "AI-powered proctoring",
    description:
      "Camera, microphone, and screen monitoring with intelligent cheating detection and a fair two-warning policy.",
  },
  {
    icon: SparklesIcon,
    title: "Instant grading & feedback",
    description:
      "Objective questions scored instantly; essays graded against rubrics with personalized improvement areas.",
  },
  {
    icon: AudioLinesIcon,
    title: "Voice-configured exams",
    description:
      "Talk to Bridge naturally — the Gemini Live assistant builds your exam spec through conversation.",
  },
  {
    icon: BarChart3Icon,
    title: "Rich analytics",
    description:
      "Performance trends by subject and level for teachers, plus platform-wide insight for administrators.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Secure by design",
    description:
      "Role-based access, audit trails, and pay-as-you-go token billing with full transparency.",
  },
] as const;

const stats = [
  { value: 8, suffix: "", label: "Secondary subjects" },
  { value: 4, suffix: "", label: "Primary subjects" },
  { value: 6, suffix: "", label: "Question types" },
  { value: 100, suffix: "%", label: "Auto-graded" },
] as const;

export default function HomePage() {
  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh flex-col overflow-hidden">
      {/* Header */}
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="bg-brand shadow-glow flex size-8 items-center justify-center rounded-xl text-primary-foreground">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4.5"
                aria-hidden
              >
                <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M6 4v2M12 4v2M18 4v2" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">Bridge</span>
          </Link>
          <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#subjects" className="transition-colors hover:text-foreground">
              Subjects
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button className="shadow-glow" nativeButton={false} render={<Link href="/setup" />}>
              Get started
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
          <FadeIn>
            <Badge variant="secondary" className="bg-brand-soft gap-1.5 px-3 py-1">
              <SparklesIcon data-icon="inline-start" />
              AI-powered assessment for Ugandan schools
            </Badge>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Exams that <span className="text-brand-gradient">build themselves</span>
              , grade themselves, and protect themselves.
            </h1>
          </FadeIn>
          <FadeIn delay={0.16}>
            <p className="text-muted-foreground max-w-2xl text-pretty text-lg">
              Bridge turns any topic into a timed, proctored, auto-graded
              assessment — with instant, personalized feedback for every
              student. Built for primary and secondary classrooms.
            </p>
          </FadeIn>
          <FadeIn delay={0.24} className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="shadow-glow h-11 px-6" nativeButton={false} render={<Link href="/setup" />}>
              Create your first exam
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Sign in to Bridge
            </Button>
          </FadeIn>

          {/* Floating preview card */}
          <FadeIn delay={0.32} className="mt-10 w-full max-w-3xl">
            <div className="gradient-border shadow-lifted animate-float rounded-2xl p-1.5">
              <div className="rounded-[calc(var(--radius-xl)-3px)] bg-card p-5 text-left sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="bg-brand-soft text-accent-foreground flex size-9 items-center justify-center rounded-lg font-medium">
                      S3
                    </span>
                    <div>
                      <p className="text-sm font-medium">Physics — Midterm Practice</p>
                      <p className="text-muted-foreground text-xs">
                        Motion &amp; forces · Medium · 30 questions
                      </p>
                    </div>
                  </div>
                  <Badge>Generating…</Badge>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="bg-muted bg-shimmer h-2.5 rounded-full" />
                  <div className="bg-muted h-2.5 w-4/5 rounded-full" />
                  <div className="bg-muted h-2.5 w-3/5 rounded-full" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["Multiple choice", "Fill in the blank", "Essay"].map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </section>

        {/* Stats */}
        <section className="border-y border-border/60 py-10">
          <Stagger className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {stats.map((s) => (
              <StaggerItem key={s.label} className="text-center">
                <p className="text-brand-gradient text-3xl font-semibold sm:text-4xl">
                  <AnimatedCounter value={s.value} />
                  {s.suffix}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{s.label}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* Features */}
        <section id="features" className="py-20 sm:py-24">
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything a modern classroom needs
            </h2>
            <p className="text-muted-foreground mt-3 text-pretty">
              From generation to grading, Bridge handles the entire assessment
              lifecycle so teachers can focus on teaching.
            </p>
          </FadeIn>
          <Stagger className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <StaggerItem key={f.title} className="h-full">
                <div className="group h-full rounded-xl border bg-card shadow-card transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lifted">
                  <div className="flex flex-col gap-3 p-6">
                    <span className="bg-brand-soft text-accent-foreground flex size-10 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110">
                      <f.icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-medium">{f.title}</h3>
                    <p className="text-muted-foreground text-sm text-pretty">
                      {f.description}
                    </p>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* Subjects */}
        <section id="subjects" className="pb-20 sm:pb-24">
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Full curriculum coverage
            </h2>
            <p className="text-muted-foreground mt-3">
              Secondary: 8 core subjects. Primary: 4 core subjects. More
              countries coming soon.
            </p>
          </FadeIn>
          <Stagger className="mt-10 flex flex-wrap justify-center gap-2.5">
            {(
              [
                "mathematics",
                "physics",
                "chemistry",
                "biology",
                "english",
                "geography",
                "history",
                "computer_studies",
              ] as const
            ).map((s) => (
              <StaggerItem key={s}>
                <Badge
                  variant="secondary"
                  className="hover:bg-brand-soft hover:text-accent-foreground px-4 py-1.5 text-sm transition-colors"
                >
                  {SUBJECT_LABELS[s]}
                </Badge>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* Pricing band */}
        <section id="pricing" className="pb-20 sm:pb-28">
          <FadeIn>
            <div className="bg-brand shadow-glow-lg relative overflow-hidden rounded-3xl px-6 py-14 text-center text-primary-foreground sm:px-12">
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "radial-gradient(30rem 18rem at 20% 0%, rgba(255,255,255,.5), transparent 60%), radial-gradient(26rem 16rem at 85% 100%, rgba(255,255,255,.35), transparent 60%)",
                }}
              />
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Pay as you go
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty opacity-90">
                No subscriptions. Tokens are consumed only when AI works —
                $0.027 per 1,000 text tokens and $0.08 per voice minute,
                billed in UGX or USD.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  variant="secondary"
                  className="h-11 px-6"
                  nativeButton={false}
                  render={<Link href="/setup" />}
                >
                  Start free setup
                </Button>
              </div>
            </div>
          </FadeIn>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} Bridge. Built for learners.</p>
          <div className="flex items-center gap-5">
            <Link href="/login" className="transition-colors hover:text-foreground">
              Sign in
            </Link>
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
