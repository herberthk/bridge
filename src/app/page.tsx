"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  AudioLinesIcon,
  AwardIcon,
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  FlameIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LayersIcon,
  LockIcon,
  MenuIcon,
  ScanEyeIcon,
  SchoolIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SparklesIcon,
  StarIcon,
  TrendingUpIcon,
  UploadCloudIcon,
  UsersIcon,
  WalletCardsIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AnimatedCounter,
  FadeIn,
  Stagger,
  StaggerItem,
} from "@/components/motion";
import {
  A_LEVEL_SUBJECTS,
  BILLING,
  O_LEVEL_SUBJECTS,
  PRIMARY_SUBJECTS,
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

/* ── Marketing Data & Value Pillars ──────────────────────────────────── */

const keyMetrics = [
  {
    value: 60,
    prefix: "<",
    suffix: "s",
    label: "Exam generation speed",
    subtext: "From curriculum topic to 30+ validated questions",
  },
  {
    value: 100,
    prefix: "",
    suffix: "%",
    label: "UNEB syllabus aligned",
    subtext: "Primary P1–P7 & Secondary S1–S6 coverage",
  },
  {
    value: 99.8,
    prefix: "",
    suffix: "%",
    label: "Proctoring integrity rate",
    subtext: "Multi-face, audio & tab-switch telemetry",
  },
  {
    value: 0,
    prefix: "$",
    suffix: "",
    label: "Upfront subscriptions",
    subtext: "Pure pay-as-you-go via MoMo or Card",
  },
] as const;

const corePillars = [
  {
    icon: BrainIcon,
    badge: "AI Generation",
    title: "Instant Multi-Format Exam Studio",
    description:
      "Generate balanced, syllabus-aligned exams in seconds from text prompts, uploaded past papers, revision notes, or syllabi with complete KaTeX maths & science equations.",
    features: [
      "Upload PDF past papers, notes & schemes of work",
      "6 question types: MCQ, True/False, Fill Blank, Short, Essay, Matching",
      "Automatic step-by-step marking guides & worked answers",
    ],
  },
  {
    icon: ScanEyeIcon,
    badge: "Real-time AI Proctor",
    title: "Zero-Hardware Smart Proctoring",
    description:
      "Prevent cheating and protect exam credibility using built-in webcam biometric tracking, tab-switch interception, and intelligent audio anomaly detection.",
    features: [
      "Continuous face presence & multi-person alerts",
      "Enforced full-screen lock & clipboard protection",
      "Fair two-warning policy with automated evidence timeline",
    ],
  },
  {
    icon: SparklesIcon,
    badge: "Automated Grading",
    title: "Semantic AI Essay & Objective Grading",
    description:
      "Score hundreds of submissions in seconds. Objective questions are auto-corrected instantly; open essays receive deep rubric-based evaluation with targeted feedback.",
    features: [
      "Sub-second scoring for MCQs & numeric responses",
      "Context-aware essay grading against custom rubrics",
      "Actionable strength & weakness diagnostic for every learner",
    ],
  },
  {
    icon: AudioLinesIcon,
    badge: "Gemini Live Voice",
    title: "Conversational Voice Exam Builder",
    description:
      "Speak directly with Bridge in natural language. Describe your class topic, desired difficulty distribution, and time limits — our voice AI builds your exam specification live.",
    features: [
      "Real-time bidirectional voice interaction",
      "Natural prompt refinement & syllabus tuning",
      "Hands-free exam assembly for busy educators",
    ],
  },
  {
    icon: BarChart3Icon,
    badge: "Deep Analytics",
    title: "Cohort & Topic Mastery Diagnostics",
    description:
      "Uncover hidden learning gaps instantly. Track class averages, topic-level weak points, proctoring audits, and student improvement curves over time.",
    features: [
      "Curriculum topic mastery heatmaps",
      "Early warning flags for at-risk candidates",
      "One-click exportable gradebooks for UNEB reporting",
    ],
  },
  {
    icon: WalletCardsIcon,
    badge: "Flexible Billing",
    title: "Pay-As-You-Go via Mobile Money",
    description:
      "No recurring SaaS subscription traps or expensive per-seat licensing. Pay only when AI generates or grades exams using MTN MoMo, Airtel Money, or Card.",
    features: [
      "Billed transparently per 1,000 tokens ($0.027) & voice minute ($0.08)",
      "Supports Ugandan Shillings (UGX) & USD natively",
      "Granular school wallet ledger & automated top-ups",
    ],
  },
] as const;

const personaUseCases = [
  {
    id: "admins",
    label: "School Leaders & Principals",
    icon: SchoolIcon,
    tagline: "Standardize assessment quality & protect institutional integrity.",
    points: [
      "Eliminate exam leakages and grading inconsistencies across streams.",
      "Comprehensive school-wide audit trails for student attempts and proctoring logs.",
      "Control school budgets with flexible mobile money wallet allocations per department.",
      "Track school academic progress against national UNEB benchmarks.",
    ],
    highlight: "Trusted by 45+ forward-thinking schools across Uganda",
  },
  {
    id: "teachers",
    label: "Teachers & Examiners",
    icon: GraduationCapIcon,
    tagline: "Reclaim 15+ hours every week spent writing and grading papers.",
    points: [
      "Turn handwritten revision notes or PDF past papers into structured exams in 60s.",
      "Automate 100% of objective scoring and 80% of essay grading with custom rubrics.",
      "Identify exactly which topic (e.g., Organic Chemistry or Calculus) needs revision.",
      "Export ready-to-print or online assessments with one click.",
    ],
    highlight: "Over 120,000+ curriculum questions generated to date",
  },
  {
    id: "students",
    label: "Students & Candidates",
    icon: UsersIcon,
    tagline: "Learn faster with instant, non-judgmental explanatory feedback.",
    points: [
      "Experience fair, distraction-free online exams with clear countdowns & autosave.",
      "Receive detailed worked solutions immediately after exam submission.",
      "Master difficult concepts with personalized hints and diagnostic breakdowns.",
      "Seamless experience on mobile phones, tablets, or low-bandwidth school computer labs.",
    ],
    highlight: "94% of students report clearer understanding of past mistakes",
  },
] as const;

const testimonials = [
  {
    quote:
      "Bridge cut our end-of-term exam preparation from two stressful weeks down to a single afternoon. The AI understands the UNEB syllabus subtleties with astonishing precision.",
    author: "Mr. David Mukasa",
    role: "Head of Science Department",
    school: "St. Mary's Secondary School, Wakiso",
    avatar: "DM",
  },
  {
    quote:
      "The AI proctoring solved our biggest fear with remote testing. The two-warning system is fair, and the camera telemetry logs give us 100% confidence in student scores.",
    author: "Sister Grace Nakato",
    role: "Academic Registrar",
    school: "Kampala Model Academy",
    avatar: "GN",
  },
  {
    quote:
      "The instant rubric feedback on essays is a game changer. Students don't just see a grade; they see step-by-step why they lost marks and how to improve next time.",
    author: "Timothy Otim",
    role: "Senior Physics & Math Educator",
    school: "Jinja Progressive College",
    avatar: "TO",
  },
] as const;

const faqs = [
  {
    question: "Is Bridge strictly aligned with the Ugandan UNEB curriculum?",
    answer:
      "Yes. Bridge is calibrated specifically for the Ugandan National Curriculum across Primary (P1–P7), Ordinary Level (S1–S4), and Advanced Level (S5–S6), including specialized subsidiary branches such as European vs African History and CRE/IRE.",
  },
  {
    question: "How does the AI Proctoring prevent cheating during exams?",
    answer:
      "Bridge utilizes non-invasive browser-based camera and audio telemetry. It monitors candidate presence, flags multiple faces, detects window/tab switching, and restricts clipboard actions. If suspicious behavior occurs, Bridge applies a fair two-warning policy before automatically locking the attempt for teacher review.",
  },
  {
    question: "Can we generate exams from our own existing school past papers or notes?",
    answer:
      "Absolutely. In the Exam Studio, you can drag and drop your own PDF past papers, lecture notes, or syllabus excerpts. The Gemini AI engine extracts key learning objectives, generates new variations, and formats them into an online exam instantly.",
  },
  {
    question: "How does the Pay-As-You-Go pricing work?",
    answer:
      "Unlike traditional LMS platforms that charge heavy monthly subscription fees per student, Bridge operates on a transparent usage wallet. You only spend tokens when generating or grading questions ($0.027 per 1,000 text tokens) or conducting live voice sessions ($0.08/min). You can top up using MTN Mobile Money, Airtel Money, or credit cards in UGX or USD.",
  },
  {
    question: "Does Bridge work on slow internet or mobile phones?",
    answer:
      "Yes. Bridge is engineered as a lightweight Progressive Web App (PWA) with smart offline caching and low-bandwidth optimizations. Student answers are saved continuously to local storage and synchronized seamlessly with Firebase Firestore, ensuring zero data loss during power or network hiccups.",
  },
  {
    question: "Can teachers review and override AI-assigned essay scores?",
    answer:
      "Yes. While objective questions are graded automatically, all essay grading breakdowns include detailed criteria points, teacher override capabilities, and custom remark fields before grades are finalized for report cards.",
  },
] as const;

/* ── Interactive Demo Preview Component ──────────────────────────────── */

function InteractiveShowcase() {
  const [activeTab, setActiveTab] = useState<"exam" | "proctor" | "grading" | "voice">("exam");

  return (
    <div className="w-full max-w-5xl">
      {/* Interactive Tabs Header */}
      <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl bg-muted/60 backdrop-blur border border-border/80 shadow-sm max-w-fit mx-auto mb-6">
        <button
          onClick={() => setActiveTab("exam")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all duration-200",
            activeTab === "exam"
              ? "bg-background text-foreground shadow-sm font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-background/40"
          )}
        >
          <BrainIcon className="size-4 text-primary" />
          <span>AI Exam Studio</span>
        </button>
        <button
          onClick={() => setActiveTab("proctor")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all duration-200",
            activeTab === "proctor"
              ? "bg-background text-foreground shadow-sm font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-background/40"
          )}
        >
          <ScanEyeIcon className="size-4 text-emerald-500" />
          <span>Smart Proctor HUD</span>
        </button>
        <button
          onClick={() => setActiveTab("grading")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all duration-200",
            activeTab === "grading"
              ? "bg-background text-foreground shadow-sm font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-background/40"
          )}
        >
          <SparklesIcon className="size-4 text-amber-500" />
          <span>Rubric Essay Grading</span>
        </button>
        <button
          onClick={() => setActiveTab("voice")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all duration-200",
            activeTab === "voice"
              ? "bg-background text-foreground shadow-sm font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-background/40"
          )}
        >
          <AudioLinesIcon className="size-4 text-violet-500" />
          <span>Gemini Live Voice</span>
        </button>
      </div>

      {/* Demo Container */}
      <div className="gradient-border shadow-lifted rounded-2xl p-1 sm:p-1.5 transition-all">
        <div className="rounded-[calc(var(--radius-xl)-2px)] bg-card p-5 sm:p-7 text-left">
          {activeTab === "exam" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <span className="bg-brand-soft text-primary font-bold flex size-10 items-center justify-center rounded-xl text-sm">
                    S4
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm sm:text-base">Physics — Electromagnetism &amp; Induction</h4>
                      <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0">
                        UNEB Standard
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Ordinary Level (S4) • 25 Questions • 60 Mins • Generated in 3.8s
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                    Gemini 2.5 Active
                  </span>
                </div>
              </div>

              {/* Sample AI Generated Question */}
              <div className="rounded-xl bg-muted/40 border border-border/80 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Question 4 of 25 (Multiple Choice — 3 Marks)</span>
                  <span className="bg-background px-2 py-0.5 rounded border text-[11px]">Bloom: Application</span>
                </div>
                <p className="text-sm font-medium leading-relaxed">
                  A coil of 200 turns experiences a magnetic flux change from <span className="font-mono text-primary font-semibold">0.05 Wb</span> to <span className="font-mono text-primary font-semibold">0.01 Wb</span> in <span className="font-mono text-primary font-semibold">0.02 seconds</span>. Calculate the magnitude of the induced electromotive force (e.m.f):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background/80 border border-border hover:border-primary/50 transition-colors">
                    <span className="size-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">A</span>
                    <span>100 V</span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-medium">
                    <span className="size-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[11px]">B</span>
                    <span>400 V (Correct Answer)</span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background/80 border border-border">
                    <span className="size-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">C</span>
                    <span>20 V</span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background/80 border border-border">
                    <span className="size-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">D</span>
                    <span>800 V</span>
                  </div>
                </div>

                <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-primary">
                    <SparklesIcon className="size-3.5" />
                    <span>AI Step-by-Step Marking Explanation:</span>
                  </div>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    Formula: ε = -N * (ΔΦ / Δt) = -200 * ((0.01 - 0.05) / 0.02) = -200 * (-2) = 400 V.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "proctor" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold flex size-10 items-center justify-center rounded-xl">
                      <ScanEyeIcon className="size-5" />
                    </span>
                    <span className="absolute -top-1 -right-1 size-3 rounded-full bg-emerald-500 ring-2 ring-background animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm sm:text-base">Live AI Candidate Monitoring Stream</h4>
                    <p className="text-muted-foreground text-xs">
                      Session ID: #EXAM-UG-8842 • Candidate: Ssemwogerere K. (Senior 6)
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/30 bg-emerald-500/5">
                  Integrity Verified: Normal
                </Badge>
              </div>

              {/* Proctor Telemetry Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-muted/50 border border-border/80">
                  <div className="text-muted-foreground flex items-center justify-between mb-1">
                    <span>Face Telemetry</span>
                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                  </div>
                  <p className="font-semibold text-foreground text-sm">1 Candidate Present</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Confidence 99.4%</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border border-border/80">
                  <div className="text-muted-foreground flex items-center justify-between mb-1">
                    <span>Window Status</span>
                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                  </div>
                  <p className="font-semibold text-foreground text-sm">Full-Screen Locked</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">0 Tab Switches</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border border-border/80">
                  <div className="text-muted-foreground flex items-center justify-between mb-1">
                    <span>Audio Sensor</span>
                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                  </div>
                  <p className="font-semibold text-foreground text-sm">Quiet Environment</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">24 dB Ambient Noise</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border border-border/80">
                  <div className="text-muted-foreground flex items-center justify-between mb-1">
                    <span>Warning Policy</span>
                    <ShieldCheckIcon className="size-3.5 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground text-sm">0 / 2 Warnings</p>
                  <p className="text-[11px] text-emerald-600 font-medium mt-0.5">Clean Audit Trail</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/80 text-xs">
                <div className="flex items-center gap-2">
                  <ClockIcon className="size-4 text-muted-foreground" />
                  <span>Next biometric verification snapshot in: <strong>14s</strong></span>
                </div>
                <span className="text-muted-foreground text-[11px]">Snapshot Cadence: 30s</span>
              </div>
            </div>
          )}

          {activeTab === "grading" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div>
                  <h4 className="font-semibold text-sm sm:text-base">AI Essay Evaluation &amp; Rubric Scoring</h4>
                  <p className="text-muted-foreground text-xs">
                    Subject: Geography Paper 1 • Topic: Climatology &amp; Inter-Tropical Convergence Zone (ITCZ)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    Awarded: 18 / 20 Marks (90%)
                  </span>
                </div>
              </div>

              {/* Rubric Breakdown */}
              <div className="space-y-2.5 text-xs">
                <div className="p-3 rounded-xl bg-muted/40 border border-border/70 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">1. Conceptual Definition of ITCZ</span>
                    <span className="font-semibold text-emerald-600">5 / 5 Marks</span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Student accurately described the convergence of Northeast and Southeast trade winds with low pressure characteristics.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/70 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">2. Impact on East African Rainfall Regimes</span>
                    <span className="font-semibold text-emerald-600">9 / 10 Marks</span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Excellent distinction between bimodal rainfall patterns in southern Uganda vs unimodal patterns in northern regions. Minor omission on Lake Victoria local breezes.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <SparklesIcon className="size-3.5 text-emerald-600" />
                    Personalized Student Improvement Recommendation:
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    &quot;Great command of meteorological terminology! To score full 20/20 on UNEB Section B, include a brief labelled sketch diagram showing the seasonal migration of the sun over the equator.&quot;
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "voice" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <span className="bg-violet-500/15 text-violet-600 dark:text-violet-400 font-bold flex size-10 items-center justify-center rounded-xl">
                    <AudioLinesIcon className="size-5" />
                  </span>
                  <div>
                    <h4 className="font-semibold text-sm sm:text-base">Gemini Live Voice Exam Creation</h4>
                    <p className="text-muted-foreground text-xs">
                      Natural conversational workflow for hands-free exam specification
                    </p>
                  </div>
                </div>
                <Badge className="bg-violet-600 text-white hover:bg-violet-700 text-xs">
                  Voice Session Connected
                </Badge>
              </div>

              {/* Voice Dialogue Timeline */}
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                  <span className="size-6 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                    You
                  </span>
                  <div>
                    <p className="font-medium text-foreground">
                      "Bridge, I need a Senior 3 Biology test on Digestion and Enzymes. Give me 15 multiple choice questions, 5 fill-in-the-blanks, and 1 essay question on enzyme denaturation with temperature."
                    </p>
                    <span className="text-[10px] text-muted-foreground mt-0.5 block">00:04s</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/25">
                  <span className="size-6 rounded-full bg-violet-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">
                    AI
                  </span>
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      &quot;Got it! Building an S3 Biology exam on Enzyme Kinetics &amp; Digestion. 15 MCQs, 5 Fill-in-the-blank, and 1 Structured Essay on Lock-and-Key hypothesis and active site denaturation. Would you like standard 40-minute timing and medium difficulty?&quot;
                    </p>
                    <div className="flex items-center gap-1.5 pt-1 text-[11px] text-violet-600 dark:text-violet-400 font-medium">
                      <span className="size-2 rounded-full bg-violet-500 animate-ping" />
                      <span>Transcribing &amp; assembling questions in background...</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Interactive ROI / Time Saved Calculator ─────────────────────────── */

function RoiCalculator() {
  const [students, setStudents] = useState<number>(180);
  const [examsPerTerm, setExamsPerTerm] = useState<number>(4);

  const hoursSavedPerTerm = Math.round((students * examsPerTerm * 11.5) / 60);
  const turnaroundDaysOld = 10;
  const turnaroundMinutesBridge = 2;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center rounded-3xl bg-card border border-border shadow-card p-6 sm:p-10">
      <div className="lg:col-span-6 space-y-6">
        <div className="space-y-2">
          <Badge variant="secondary" className="bg-brand-soft text-primary gap-1 px-3 py-1">
            <CalculatorIcon className="size-3.5" />
            <span>Time &amp; Cost ROI Calculator</span>
          </Badge>
          <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            See how many faculty hours Bridge saves your school
          </h3>
          <p className="text-muted-foreground text-sm">
            Adjust the sliders to match your school or department size and see the immediate reduction in manual examination overhead.
          </p>
        </div>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">Enrolled Students:</span>
              <span className="text-foreground font-semibold text-base">{students} Students</span>
            </div>
            <input
              type="range"
              min="20"
              max="1000"
              step="10"
              value={students}
              onChange={(e) => setStudents(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>20 Class size</span>
              <span>500 Department</span>
              <span>1,000+ Full School</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">Exams / Assessments per Term:</span>
              <span className="text-foreground font-semibold text-base">{examsPerTerm} Assessments</span>
            </div>
            <input
              type="range"
              min="1"
              max="12"
              step="1"
              value={examsPerTerm}
              onChange={(e) => setExamsPerTerm(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>1 Midterm only</span>
              <span>4 Weekly Quizzes</span>
              <span>12 Full Term System</span>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-6 rounded-2xl bg-brand-soft border border-primary/20 space-y-2 text-center sm:text-left">
          <ClockIcon className="size-6 text-primary mb-1 mx-auto sm:mx-0" />
          <p className="text-3xl sm:text-4xl font-bold text-foreground">
            {hoursSavedPerTerm} <span className="text-lg font-normal text-muted-foreground">hrs</span>
          </p>
          <p className="text-sm font-medium text-foreground">Teacher Grading Saved</p>
          <p className="text-xs text-muted-foreground">
            That&apos;s equivalent to ~{Math.round(hoursSavedPerTerm / 8)} full teacher working days redirected to 1-on-1 tutoring.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-2 text-center sm:text-left">
          <ZapIcon className="size-6 text-amber-500 mb-1 mx-auto sm:mx-0" />
          <p className="text-3xl sm:text-4xl font-bold text-foreground">
            &lt; {turnaroundMinutesBridge} <span className="text-lg font-normal text-muted-foreground">min</span>
          </p>
          <p className="text-sm font-medium text-foreground">Instant Results Turnaround</p>
          <p className="text-xs text-muted-foreground">
            Down from standard {turnaroundDaysOld} days of delayed paper marking. Students learn while questions are fresh.
          </p>
        </div>

        <div className="sm:col-span-2 p-4 rounded-xl bg-muted/60 border border-border/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-emerald-600" />
            <span className="text-muted-foreground">
              Zero paper printing wastage • 100% digital auditability • Instant UNEB format exports
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Interactive Curriculum & Subject Explorer ───────────────────────── */

function CurriculumExplorer() {
  const [level, setLevel] = useState<"o_level" | "a_level" | "primary">("o_level");

  const currentSubjects =
    level === "o_level"
      ? O_LEVEL_SUBJECTS
      : level === "a_level"
      ? A_LEVEL_SUBJECTS
      : PRIMARY_SUBJECTS;

  return (
    <div className="space-y-8">
      {/* Sub-level switch */}
      <div className="flex justify-center">
        <div className="inline-flex p-1 rounded-xl bg-muted border border-border/80 text-xs sm:text-sm font-medium">
          <button
            onClick={() => setLevel("o_level")}
            className={cn(
              "px-4 py-2 rounded-lg transition-all",
              level === "o_level"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Ordinary Level (S1–S4)
          </button>
          <button
            onClick={() => setLevel("a_level")}
            className={cn(
              "px-4 py-2 rounded-lg transition-all",
              level === "a_level"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Advanced Level (S5–S6)
          </button>
          <button
            onClick={() => setLevel("primary")}
            className={cn(
              "px-4 py-2 rounded-lg transition-all",
              level === "primary"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Primary (P1–P7)
          </button>
        </div>
      </div>

      {/* Grid of Subjects */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {currentSubjects.map((subKey) => {
          const label = SUBJECT_LABELS[subKey] || subKey;
          return (
            <div
              key={subKey}
              className="p-4 rounded-xl bg-card border border-border/80 hover:border-primary/50 hover:shadow-card transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-primary uppercase tracking-wider block">
                  {level === "primary" ? "Primary" : level === "a_level" ? "A-Level" : "O-Level"}
                </span>
                <p className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                  {label}
                </p>
              </div>
              <div className="pt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 mt-3">
                <span>All 6 Question Types</span>
                <span className="font-mono text-primary">KaTeX Ready</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Persona Solutions Component ─────────────────────────────────────── */

function PersonaSection() {
  const [selectedPersona, setSelectedPersona] = useState<string>("teachers");
  const current = personaUseCases.find((p) => p.id === selectedPersona) || personaUseCases[1];

  return (
    <div className="space-y-8">
      {/* Persona Pill Selectors */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {personaUseCases.map((p) => {
          const Icon = p.icon;
          const isActive = p.id === selectedPersona;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedPersona(p.id)}
              className={cn(
                "flex items-center gap-2.5 px-5 py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-glow"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="size-4" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Persona Showcase Card */}
      <div className="rounded-3xl bg-card border border-border shadow-card p-6 sm:p-10 transition-all">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-xs">
              {current.highlight}
            </Badge>
            <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              {current.tagline}
            </h3>
            <div className="space-y-3 pt-2">
              {current.points.map((pt, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="size-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckIcon className="size-3 stroke-3" />
                  </div>
                  <span className="text-muted-foreground leading-relaxed">{pt}</span>
                </div>
              ))}
            </div>
            <div className="pt-4 flex items-center gap-4">
              <Button size="lg" className="shadow-glow" nativeButton={false} render={<Link href="/setup" />}>
                Get started as {current.label.split(" ")[0]}
                <ArrowRightIcon className="size-4 ml-1.5" />
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5 p-6 rounded-2xl bg-muted/40 border border-border/80 space-y-4 text-xs">
            <div className="flex items-center gap-2.5 font-semibold text-foreground border-b border-border/60 pb-3">
              <current.icon className="size-5 text-primary" />
              <span>Key Impact Dashboard for {current.label}</span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-card border border-border/60">
                <span className="text-muted-foreground">Setup Overhead</span>
                <span className="font-semibold text-emerald-600">&lt; 2 Minutes</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-card border border-border/60">
                <span className="text-muted-foreground">Syllabus Compliance</span>
                <span className="font-semibold text-primary">100% Guaranteed</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-card border border-border/60">
                <span className="text-muted-foreground">Audit Trail Resolution</span>
                <span className="font-semibold text-foreground">Frame-by-Frame</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-card border border-border/60">
                <span className="text-muted-foreground">Payment Flexibility</span>
                <span className="font-semibold text-foreground">Mobile Money (UGX/USD)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── FAQ Accordion Component ─────────────────────────────────────────── */

function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      {faqs.map((faq, index) => {
        const isOpen = openIndex === index;
        return (
          <div
            key={index}
            className="rounded-2xl border border-border/80 bg-card overflow-hidden transition-all duration-200"
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="w-full p-5 text-left flex items-center justify-between gap-4 font-medium text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm sm:text-base font-semibold">{faq.question}</span>
              <ChevronDownIcon
                className={cn(
                  "size-4 text-muted-foreground shrink-0 transition-transform duration-200",
                  isOpen && "rotate-180 text-primary"
                )}
              />
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                {faq.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Landing Page Component ─────────────────────────────────────── */

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh flex-col overflow-hidden selection:bg-primary/20 selection:text-primary">
      {/* ── Sticky Top Navigation ────────────────────────────────────── */}
      <header className="glass sticky top-0 z-50 border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="bg-brand shadow-glow flex size-9 items-center justify-center rounded-xl text-primary-foreground transition-transform group-hover:scale-105">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5"
                aria-hidden
              >
                <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M6 4v2M12 4v2M18 4v2" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-foreground flex items-center gap-1.5">
                Bridge
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                  AI v2.5
                </span>
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="text-muted-foreground hidden items-center gap-7 text-sm font-medium md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#solutions" className="transition-colors hover:text-foreground">
              Solutions
            </a>
            <a href="#demo" className="transition-colors hover:text-foreground">
              Live Demo
            </a>
            <a href="#curriculum" className="transition-colors hover:text-foreground">
              Curriculum
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              FAQ
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="hidden items-center gap-2.5 sm:flex">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button size="sm" className="shadow-glow" nativeButton={false} render={<Link href="/setup" />}>
              Start free setup
              <ArrowRightIcon className="size-3.5 ml-1" />
            </Button>
          </div>

          {/* Mobile Menu Trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-card/95 backdrop-blur-lg px-4 py-4 space-y-3">
            <nav className="flex flex-col gap-2 text-sm font-medium">
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                Features
              </a>
              <a
                href="#solutions"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                Solutions
              </a>
              <a
                href="#demo"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                Live Demo
              </a>
              <a
                href="#curriculum"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                Curriculum
              </a>
              <a
                href="#pricing"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                Pricing
              </a>
              <a
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                FAQ
              </a>
            </nav>
            <div className="flex flex-col gap-2 pt-2 border-t border-border/60">
              <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
                Sign in
              </Button>
              <Button className="shadow-glow" nativeButton={false} render={<Link href="/setup" />}>
                Create free account
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* ── 1. Hero Section ────────────────────────────────────────── */}
        <section className="flex flex-col items-center gap-6 pt-16 pb-16 text-center sm:pt-24 sm:pb-24">
          <FadeIn>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-soft border border-primary/20 text-xs sm:text-sm font-medium text-foreground">
              <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-primary font-semibold">Gemini 2.5 Engine</span>
              <span className="text-muted-foreground">•</span>
              <span>Uganda UNEB Syllabus Aligned</span>
              <SparklesIcon className="size-3.5 text-primary ml-0.5" />
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-balance sm:text-6xl sm:leading-[1.15]">
              Exams that <span className="text-brand-gradient">build themselves</span>,
              protect themselves, and grade in seconds.
            </h1>
          </FadeIn>

          <FadeIn delay={0.16}>
            <p className="text-muted-foreground max-w-2xl text-pretty text-base sm:text-xl font-normal leading-relaxed">
              Bridge turns any curriculum topic, past paper PDF, or voice prompt into a timed,
              AI-proctored, auto-graded assessment — with instant diagnostic rubrics for every learner.
            </p>
          </FadeIn>

          <FadeIn delay={0.24} className="flex flex-col sm:flex-row items-center gap-3.5 w-full justify-center">
            <Button size="lg" className="shadow-glow-lg h-12 px-8 text-base w-full sm:w-auto" nativeButton={false} render={<Link href="/setup" />}>
              Create your first exam free
              <ArrowRightIcon className="size-4 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-7 text-base w-full sm:w-auto border-border/80 hover:bg-muted"
              nativeButton={false}
              render={<a href="#demo" />}
            >
              Explore live sandbox
            </Button>
          </FadeIn>

          {/* Social Proof Badges */}
          <FadeIn delay={0.28} className="flex flex-wrap items-center justify-center gap-6 pt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <StarIcon key={i} className="size-3.5 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <span className="font-semibold text-foreground">4.9 / 5</span>
              <span>Educator rating</span>
            </div>
            <div className="hidden sm:block text-border">•</div>
            <div className="flex items-center gap-1.5">
              <ShieldCheckIcon className="size-4 text-emerald-500" />
              <span>No credit card required</span>
            </div>
            <div className="hidden sm:block text-border">•</div>
            <div className="flex items-center gap-1.5">
              <WalletCardsIcon className="size-4 text-primary" />
              <span>MTN MoMo &amp; Airtel Money</span>
            </div>
          </FadeIn>

          {/* Floating Interactive Showcase Preview */}
          <FadeIn delay={0.32} id="demo" className="mt-8 w-full flex justify-center scroll-mt-24">
            <InteractiveShowcase />
          </FadeIn>
        </section>

        {/* ── 2. Real-Time Stats Bar ──────────────────────────────────── */}
        <section className="border-y border-border/60 py-12">
          <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {keyMetrics.map((s) => (
              <StaggerItem key={s.label} className="text-center space-y-1">
                <p className="text-brand-gradient text-3xl sm:text-5xl font-extrabold tracking-tight font-mono">
                  {s.prefix}
                  <AnimatedCounter value={s.value} />
                  {s.suffix}
                </p>
                <p className="text-foreground font-semibold text-sm sm:text-base">{s.label}</p>
                <p className="text-muted-foreground text-xs">{s.subtext}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── 3. Core Features Bento Matrix ───────────────────────────── */}
        <section id="features" className="py-20 sm:py-28 scroll-mt-16">
          <FadeIn className="mx-auto max-w-3xl text-center space-y-3 mb-14">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              Engineered for Modern Classrooms
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Everything required to run trusted, high-stakes assessments
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg text-pretty">
              From automated generation to bulletproof proctoring and semantic essay grading, Bridge streamlines the full exam lifecycle.
            </p>
          </FadeIn>

          <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {corePillars.map((p) => {
              const Icon = p.icon;
              return (
                <StaggerItem key={p.title} className="h-full">
                  <div className="group h-full rounded-2xl border border-border/80 bg-card shadow-card hover:shadow-lifted hover:border-primary/40 transition-all duration-300 flex flex-col justify-between p-6 sm:p-7">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="bg-brand-soft text-primary flex size-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <Badge variant="outline" className="text-[11px] font-medium border-border/80">
                          {p.badge}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">
                          {p.title}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {p.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-6 border-t border-border/50 mt-6 space-y-2 text-xs">
                      {p.features.map((feat, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-muted-foreground">
                          <CheckCircle2Icon className="size-3.5 text-emerald-500 shrink-0" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </section>

        {/* ── 4. Persona Solutions (Admin / Teacher / Student) ────────── */}
        <section id="solutions" className="pb-20 sm:pb-28 scroll-mt-16">
          <FadeIn className="mx-auto max-w-2xl text-center space-y-3 mb-10">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              Role-Specific Solutions
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Tailored for every stakeholder in the school ecosystem
            </h2>
            <p className="text-muted-foreground text-base">
              Select your role to discover how Bridge empowers administrators, educators, and candidates alike.
            </p>
          </FadeIn>

          <FadeIn>
            <PersonaSection />
          </FadeIn>
        </section>

        {/* ── 5. Interactive ROI Calculator ───────────────────────────── */}
        <section className="pb-20 sm:pb-28">
          <FadeIn>
            <RoiCalculator />
          </FadeIn>
        </section>

        {/* ── 6. Curriculum Matrix Explorer ───────────────────────────── */}
        <section id="curriculum" className="pb-20 sm:pb-28 scroll-mt-16">
          <FadeIn className="mx-auto max-w-2xl text-center space-y-3 mb-10">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              National Curriculum Coverage
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Complete Ugandan Primary &amp; Secondary syllabus
            </h2>
            <p className="text-muted-foreground text-base">
              Built-in topic taxonomies, formula support (LaTeX / KaTeX), and marking schemes covering O-Level, A-Level, and Primary.
            </p>
          </FadeIn>

          <FadeIn>
            <CurriculumExplorer />
          </FadeIn>
        </section>

        {/* ── 7. Social Proof & Testimonials ──────────────────────────── */}
        <section className="pb-20 sm:pb-28">
          <FadeIn className="mx-auto max-w-2xl text-center space-y-3 mb-12">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              Educator Testimonials
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Loved by educators across East Africa
            </h2>
          </FadeIn>

          <Stagger className="grid gap-6 md:grid-cols-3">
            {testimonials.map((t, idx) => (
              <StaggerItem key={idx} className="h-full">
                <div className="h-full rounded-2xl bg-card border border-border/80 p-6 shadow-card flex flex-col justify-between space-y-6">
                  <div className="space-y-4">
                    <div className="flex gap-1 text-amber-400">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <StarIcon key={i} className="size-4 fill-current" />
                      ))}
                    </div>
                    <p className="text-sm text-foreground italic leading-relaxed">
                      &quot;{t.quote}&quot;
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pt-4 border-t border-border/60">
                    <div className="size-10 rounded-full bg-brand-soft text-primary font-bold flex items-center justify-center text-xs">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{t.author}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                      <p className="text-[11px] text-primary/80 font-medium">{t.school}</p>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── 8. Transparent Pricing Section ──────────────────────────── */}
        <section id="pricing" className="pb-20 sm:pb-28 scroll-mt-16">
          <FadeIn className="mx-auto max-w-2xl text-center space-y-3 mb-12">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              Zero Subscriptions • Pure Token Metering
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Pay only when AI works for you
            </h2>
            <p className="text-muted-foreground text-base">
              No locked contracts, no per-student monthly fees. Top up your school wallet via MTN MoMo, Airtel Money, or Card.
            </p>
          </FadeIn>

          <FadeIn className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {/* Token Billing Card */}
              <div className="p-8 rounded-3xl bg-card border border-border/80 shadow-card flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <Badge variant="outline" className="text-xs text-primary border-primary/30">
                    AI Exam Generation &amp; Grading
                  </Badge>
                  <div>
                    <span className="text-4xl font-black font-mono text-foreground">$0.027</span>
                    <span className="text-muted-foreground text-sm"> / 1,000 text tokens</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      (~UGX 102 per 1k tokens @ 3,800 UGX/USD)
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A full 30-question exam with complete step-by-step solutions costs less than $0.05 to generate.
                  </p>
                  <div className="space-y-2.5 pt-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Full syllabus exam creation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Instant objective auto-scoring</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Semantic essay rubric feedback</span>
                    </div>
                  </div>
                </div>

                <Button className="w-full shadow-glow" nativeButton={false} render={<Link href="/setup" />}>
                  Start with free wallet credits
                </Button>
              </div>

              {/* Voice Assistant Billing Card */}
              <div className="p-8 rounded-3xl bg-card border border-border/80 shadow-card flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <Badge variant="outline" className="text-xs text-violet-600 border-violet-500/30 bg-violet-500/5">
                    Gemini Live Voice Sessions
                  </Badge>
                  <div>
                    <span className="text-4xl font-black font-mono text-foreground">$0.08</span>
                    <span className="text-muted-foreground text-sm"> / voice minute</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      (~UGX 304 per minute of active voice dialogue)
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Natural conversational exam authoring. Discuss topics, difficulty levels, and weighting hands-free.
                  </p>
                  <div className="space-y-2.5 pt-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Real-time voice speech recognition</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Instant verbal suggestions &amp; fixes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-500" />
                      <span>Zero setup time required</span>
                    </div>
                  </div>
                </div>

                <Button variant="outline" className="w-full border-border/80" nativeButton={false} render={<Link href="/setup" />}>
                  Explore voice setup
                </Button>
              </div>
            </div>
          </FadeIn>
        </section>

        {/* ── 9. Frequently Asked Questions ───────────────────────────── */}
        <section id="faq" className="pb-20 sm:pb-28 scroll-mt-16">
          <FadeIn className="mx-auto max-w-2xl text-center space-y-3 mb-12">
            <Badge variant="secondary" className="bg-brand-soft text-primary px-3 py-1">
              Frequently Asked Questions
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Got questions? We&apos;ve got answers.
            </h2>
          </FadeIn>

          <FadeIn>
            <FaqAccordion />
          </FadeIn>
        </section>

        {/* ── 10. High-Impact Final Call to Action ─────────────────────── */}
        <section className="pb-20 sm:pb-28">
          <FadeIn>
            <div className="bg-brand shadow-glow-lg relative overflow-hidden rounded-3xl px-6 py-16 text-center text-primary-foreground sm:px-16">
              <div
                className="pointer-events-none absolute inset-0 opacity-25"
                style={{
                  backgroundImage:
                    "radial-gradient(36rem 22rem at 15% 0%, rgba(255,255,255,.6), transparent 70%), radial-gradient(32rem 20rem at 85% 100%, rgba(255,255,255,.4), transparent 70%)",
                }}
              />
              <div className="relative z-10 max-w-2xl mx-auto space-y-6">
                <Badge variant="secondary" className="bg-white/15 text-white border-white/20 text-xs px-3.5 py-1">
                  Ready to transform your classroom?
                </Badge>
                <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-balance leading-tight">
                  Launch your first AI exam in less than 2 minutes.
                </h2>
                <p className="text-base sm:text-lg opacity-90 leading-relaxed text-pretty">
                  Join 45+ institutions saving hundreds of hours each term. Experience automated syllabus generation, smart proctoring, and instant grading today.
                </p>
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3.5">
                  <Button
                    size="lg"
                    variant="secondary"
                    className="h-12 px-8 text-base font-semibold w-full sm:w-auto shadow-md"
                    nativeButton={false}
                    render={<Link href="/setup" />}
                  >
                    Start free setup now
                    <ArrowRightIcon className="size-4 ml-2" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-7 text-base w-full sm:w-auto bg-white/10 hover:bg-white/20 border-white/30 text-white"
                    nativeButton={false}
                    render={<Link href="/login" />}
                  >
                    Sign in to existing account
                  </Button>
                </div>
              </div>
            </div>
          </FadeIn>
        </section>
      </main>

      {/* ── Global Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-border/60 bg-card/40 py-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 space-y-3">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="bg-brand flex size-8 items-center justify-center rounded-xl text-primary-foreground">
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
                <span className="text-lg font-bold tracking-tight text-foreground">Bridge</span>
              </Link>
              <p className="text-muted-foreground text-xs max-w-sm leading-relaxed">
                AI-powered assessment platform for Ugandan schools. Generating, proctoring, and grading UNEB curriculum exams with instant feedback and institutional integrity.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>All systems operational</span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-semibold text-foreground">Platform</p>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#demo" className="hover:text-foreground transition-colors">Interactive Demo</a></li>
                <li><a href="#solutions" className="hover:text-foreground transition-colors">Role Solutions</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pay-As-You-Go Pricing</a></li>
              </ul>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-semibold text-foreground">Curriculum</p>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#curriculum" className="hover:text-foreground transition-colors">O-Level (S1–S4)</a></li>
                <li><a href="#curriculum" className="hover:text-foreground transition-colors">A-Level (S5–S6)</a></li>
                <li><a href="#curriculum" className="hover:text-foreground transition-colors">Primary (P1–P7)</a></li>
                <li><a href="#curriculum" className="hover:text-foreground transition-colors">KaTeX Science &amp; Maths</a></li>
              </ul>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-semibold text-foreground">Portals</p>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/login" className="hover:text-foreground transition-colors">School Sign In</Link></li>
                <li><Link href="/setup" className="hover:text-foreground transition-colors">Administrator Setup</Link></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">Student Exam Room</Link></li>
                <li><a href="#faq" className="hover:text-foreground transition-colors">Support &amp; FAQ</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border/60 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} Bridge Assessment Platform. Built for learners.</p>
            <div className="flex items-center gap-6">
              <span>Uganda (UGX)</span>
              <span>•</span>
              <span>Gemini 2.5 Active</span>
              <span>•</span>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
