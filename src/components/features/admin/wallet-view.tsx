"use client";

import { useMemo, useState, useCallback } from "react";
import { format, formatDistanceToNow, isAfter, subDays, startOfDay } from "date-fns";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronUpIcon,
  CoinsIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  MicIcon,
  PlusCircleIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletCardsIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import {
  estimateGenerationTokens,
  estimateGradingTokens,
  formatTokens,
  formatUgx,
  formatUsd,
  reserveForGeneration,
  tokensToUsd,
  TOPUP_PACKS,
  usdToUgx,
  voiceMinutesToUsd,
} from "@/lib/pricing";
import type { TransactionCategory, TransactionDoc, WalletDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { AnimatedCounter, FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types & Configuration ──────────────────────────────────────────────────

type SortField = "createdAt" | "description" | "category" | "tokensDelta" | "balanceAfter" | "usdMicros";
type SortDir = "asc" | "desc";
type DateFilter = "all" | "today" | "7days" | "30days";
type DirectionFilter = "all" | "consumption" | "topup";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const CATEGORY_CONFIG: Record<
  TransactionCategory,
  {
    label: string;
    icon: React.ElementType;
    badgeClass: string;
  }
> = {
  text_generation: {
    label: "Exam Generation",
    icon: SparklesIcon,
    badgeClass: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300 dark:bg-indigo-500/20",
  },
  grading: {
    label: "AI Auto-Grading",
    icon: CheckCircle2Icon,
    badgeClass: "bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300 dark:bg-teal-500/20",
  },
  voice: {
    label: "Voice Builder",
    icon: MicIcon,
    badgeClass: "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300 dark:bg-violet-500/20",
  },
  topup: {
    label: "Wallet Top-up",
    icon: PlusCircleIcon,
    badgeClass: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300 dark:bg-emerald-500/20",
  },
  adjustment: {
    label: "System Adjustment",
    icon: RefreshCwIcon,
    badgeClass: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300 dark:bg-amber-500/20",
  },
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

/** Interactive AI Cost & Capacity Estimator Dialog */
function CostEstimatorDialog({ currentBalance }: { currentBalance: number }) {
  const [open, setOpen] = useState(false);
  const [questionCount, setQuestionCount] = useState<number>(15);
  const [hasDocuments, setHasDocuments] = useState<boolean>(true);
  const [voiceMins, setVoiceMins] = useState<number>(0);
  const [gradingAttempts, setGradingAttempts] = useState<number>(30);

  const genTokens = useMemo(
    () => estimateGenerationTokens(questionCount, hasDocuments),
    [questionCount, hasDocuments],
  );
  const genReserve = useMemo(() => reserveForGeneration(genTokens), [genTokens]);
  const gradingTokens = useMemo(
    () => (gradingAttempts > 0 ? estimateGradingTokens(questionCount) * gradingAttempts : 0),
    [questionCount, gradingAttempts],
  );
  const voiceCostUsd = useMemo(() => voiceMinutesToUsd(voiceMins), [voiceMins]);
  const totalEstimatedTokens = genTokens + gradingTokens;
  const totalCostUsd = tokensToUsd(totalEstimatedTokens) + voiceCostUsd;
  const totalCostUgx = usdToUgx(totalCostUsd);

  const canAffordGeneration = currentBalance >= genReserve;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <CalculatorIcon data-icon="inline-start" />
        Cost calculator
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
              <CalculatorIcon className="size-4" />
            </span>
            AI Token &amp; Cost Estimator
          </DialogTitle>
          <DialogDescription>
            Simulate the required tokens and fiat costs for generating and auto-grading exams before running tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                Exam Question Count ({questionCount} questions)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="accent-primary h-2 w-full cursor-pointer rounded-lg bg-muted"
                />
                <span className="w-8 text-right font-mono text-sm font-semibold">{questionCount}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                Student Attempts to Auto-Grade ({gradingAttempts} students)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={gradingAttempts}
                  onChange={(e) => setGradingAttempts(Number(e.target.value))}
                  className="accent-primary h-2 w-full cursor-pointer rounded-lg bg-muted"
                />
                <span className="w-8 text-right font-mono text-sm font-semibold">{gradingAttempts}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="calc-docs"
                checked={hasDocuments}
                onChange={(e) => setHasDocuments(e.target.checked)}
                className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="calc-docs" className="cursor-pointer text-xs font-medium">
                Include past paper / syllabus grounding documents (+6k tokens)
              </label>
            </div>
          </div>

          {/* Breakdown cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <SparklesIcon className="size-3 text-indigo-500" />
                Exam Generation
              </div>
              <p className="mt-1 font-mono text-base font-semibold">{formatTokens(genTokens)}</p>
              <p className="text-muted-foreground text-xs">
                Reserve: {formatTokens(genReserve)}
              </p>
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <CheckCircle2Icon className="size-3 text-teal-500" />
                Auto-Grading
              </div>
              <p className="mt-1 font-mono text-base font-semibold">{formatTokens(gradingTokens)}</p>
              <p className="text-muted-foreground text-xs">
                {gradingAttempts} × ~{Math.round(gradingTokens / Math.max(gradingAttempts, 1))} tokens
              </p>
            </div>

            <div className="col-span-2 rounded-lg border bg-card p-3 sm:col-span-1">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <ReceiptIcon className="size-3 text-emerald-500" />
                Estimated Value
              </div>
              <p className="mt-1 font-mono text-base font-semibold text-emerald-600 dark:text-emerald-400">
                {formatUsd(totalCostUsd)}
              </p>
              <p className="text-muted-foreground text-xs">
                ≈ {formatUgx(totalCostUgx)}
              </p>
            </div>
          </div>

          {/* Wallet Affordability Check */}
          <div
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
              canAffordGeneration
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            }`}
          >
            {canAffordGeneration ? (
              <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="flex-1">
              <p className="font-semibold">
                {canAffordGeneration
                  ? "Wallet balance is sufficient for this generation."
                  : "Insufficient balance for generation reserve."}
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                {canAffordGeneration
                  ? `Your balance covers the ${formatTokens(genReserve)} tokens safety buffer (3× standard estimate).`
                  : `You need at least ${formatTokens(genReserve)} available tokens to launch this generation. You currently have ${formatTokens(currentBalance)}.`}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Top-Up Guide & Request Package Dialog */
function TopupGuideDialog({
  walletId,
  ownerLabel,
}: {
  walletId: string;
  ownerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPack, setSelectedPack] = useState<number>(TOPUP_PACKS[1].tokens);
  const [copied, setCopied] = useState(false);

  const packObj = TOPUP_PACKS.find((p) => p.tokens === selectedPack) ?? TOPUP_PACKS[1];
  const usdPrice = tokensToUsd(selectedPack);
  const ugxPrice = usdToUgx(usdPrice);

  const handleCopyRequest = () => {
    const text = `Hi Admin, please credit our ${ownerLabel} wallet (ID: ${walletId}) with the ${packObj.label} Package: ${formatTokens(selectedPack)} tokens (${formatUsd(usdPrice)} / ${formatUgx(ugxPrice)}). Thank you!`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Top-up request copied to clipboard!");
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <CoinsIcon data-icon="inline-start" />
        Request top-up
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex size-8 items-center justify-center rounded-lg">
              <PlusCircleIcon className="size-4" />
            </span>
            Credit Your Wallet
          </DialogTitle>
          <DialogDescription>
            Select a token top-up pack to calculate pricing and send a credit request to your platform administrator.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Pack Options */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {TOPUP_PACKS.map((pack) => {
              const active = pack.tokens === selectedPack;
              const packUsd = tokensToUsd(pack.tokens);
              return (
                <button
                  key={pack.tokens}
                  type="button"
                  onClick={() => setSelectedPack(pack.tokens)}
                  className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all ${
                    active
                      ? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/30"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <span className="text-xs font-semibold">{pack.label}</span>
                  <span className="mt-1 font-mono text-sm font-bold text-foreground">
                    {formatTokens(pack.tokens >= 1_000_000 ? pack.tokens / 1_000_000 : pack.tokens / 1_000)}
                    <span className="text-muted-foreground text-xs font-normal">
                      {pack.tokens >= 1_000_000 ? "M" : "k"}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-1 text-[11px]">
                    {formatUsd(packUsd)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Pricing Box */}
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Selected volume</span>
              <span className="font-mono font-semibold">{formatTokens(selectedPack)} tokens</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Standard USD Value</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {formatUsd(usdPrice)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
              <span className="font-medium">Uganda Shillings Equivalent</span>
              <span className="font-mono font-bold text-foreground">
                {formatUgx(ugxPrice)}
              </span>
            </div>
          </div>

          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <InfoIcon className="size-4 shrink-0 text-primary" />
            <span>
              Rates: $0.027 per 1,000 text tokens · $0.08 per voice minute · Fixed at 1 USD = 3,800 UGX.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handleCopyRequest}>
            {copied ? (
              <>
                <CheckIcon data-icon="inline-start" />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon data-icon="inline-start" />
                Copy request template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function WalletView({
  wallet,
  transactions,
  ownerLabel,
  loadFailed = false,
}: {
  wallet: SerializedWithId<WalletDoc> | null;
  transactions: SerializedWithId<TransactionDoc>[];
  ownerLabel: string;
  loadFailed?: boolean;
}) {
  // ─── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // ─── Derived Statistics ─────────────────────────────────────────────────────
  const balance = wallet?.balanceTokens ?? 0;
  const totalTopup = wallet?.totalTopupTokens ?? 0;
  const totalConsumed = wallet?.totalConsumedTokens ?? 0;
  const balanceUsd = tokensToUsd(balance);
  const balanceUgx = usdToUgx(balanceUsd);
  const topupUsd = tokensToUsd(totalTopup);
  const topupUgx = usdToUgx(topupUsd);
  const consumedUsd = tokensToUsd(totalConsumed);
  const consumedUgx = usdToUgx(consumedUsd);

  // Health Level
  const healthStatus = useMemo(() => {
    if (balance > 100_000) return { label: "Optimal Reserve", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" };
    if (balance > 25_000) return { label: "Moderate Balance", badge: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" };
    return { label: "Low Reserve", badge: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300" };
  }, [balance]);

  // Capacity estimate: standard 15-question exam with grounding documents ~16,500 tokens
  const estimatedExamsPossible = Math.floor(balance / 16_500);

  // ─── Filtering & Sorting ────────────────────────────────────────────────────
  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const query = search.trim().toLowerCase();

    return transactions.filter((tx) => {
      // 1. Search Query
      if (query) {
        const matchesDesc = tx.description?.toLowerCase().includes(query);
        const matchesCat = tx.category?.toLowerCase().includes(query);
        const matchesRef = tx.refId?.toLowerCase().includes(query);
        const matchesTokens = String(Math.abs(tx.tokensDelta)).includes(query);
        if (!matchesDesc && !matchesCat && !matchesRef && !matchesTokens) {
          return false;
        }
      }

      // 2. Category Filter
      if (categoryFilter !== "all" && tx.category !== categoryFilter) {
        return false;
      }

      // 3. Direction Filter
      if (directionFilter === "consumption" && tx.tokensDelta >= 0) return false;
      if (directionFilter === "topup" && tx.tokensDelta < 0) return false;

      // 4. Date Filter
      if (dateFilter !== "all" && tx.createdAt) {
        const txDate = parseDate(tx.createdAt);
        if (!txDate) return false;

        if (dateFilter === "today") {
          const todayStart = startOfDay(now);
          if (!isAfter(txDate, todayStart)) return false;
        } else if (dateFilter === "7days") {
          const sevenDaysAgo = subDays(now, 7);
          if (!isAfter(txDate, sevenDaysAgo)) return false;
        } else if (dateFilter === "30days") {
          const thirtyDaysAgo = subDays(now, 30);
          if (!isAfter(txDate, thirtyDaysAgo)) return false;
        }
      }

      return true;
    });
  }, [transactions, search, categoryFilter, directionFilter, dateFilter]);

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "createdAt": {
          const timeA = a.createdAt ? parseDate(a.createdAt)?.getTime() ?? 0 : 0;
          const timeB = b.createdAt ? parseDate(b.createdAt)?.getTime() ?? 0 : 0;
          comparison = timeA - timeB;
          break;
        }
        case "description":
          comparison = (a.description || "").localeCompare(b.description || "");
          break;
        case "category":
          comparison = (a.category || "").localeCompare(b.category || "");
          break;
        case "tokensDelta":
          comparison = Math.abs(a.tokensDelta) - Math.abs(b.tokensDelta);
          break;
        case "balanceAfter":
          comparison = (a.balanceAfter ?? 0) - (b.balanceAfter ?? 0);
          break;
        case "usdMicros":
          comparison = (a.usdMicros ?? 0) - (b.usdMicros ?? 0);
          break;
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [filteredTransactions, sortField, sortDir]);

  // ─── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedTransactions = sortedTransactions.slice(startIndex, startIndex + pageSize);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
      setPage(1);
    },
    [sortField],
  );

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setCategoryFilter("all");
    setDirectionFilter("all");
    setDateFilter("all");
    setPage(1);
  }, []);

  const hasActiveFilters = search || categoryFilter !== "all" || directionFilter !== "all" || dateFilter !== "all";

  // ─── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (sortedTransactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    const headers = ["Date", "Category", "Description", "Tokens Delta", "Balance After", "USD Value", "UGX Value", "Reference ID"];
    const rows = sortedTransactions.map((t) => {
      const dateStr = t.createdAt ? format(parseDate(t.createdAt)!, "yyyy-MM-dd HH:mm:ss") : "";
      const usd = t.usdMicros > 0 ? (t.usdMicros / 1_000_000).toFixed(4) : "0";
      const ugx = t.ugx ? String(t.ugx) : "0";
      return [
        `"${dateStr}"`,
        `"${t.category || ""}"`,
        `"${(t.description || "").replace(/"/g, '""')}"`,
        t.tokensDelta,
        t.balanceAfter,
        usd,
        ugx,
        `"${t.refId || ""}"`,
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `wallet_transactions_${format(new Date(), "yyyyMMdd_HHmm")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${sortedTransactions.length} transactions as CSV`);
  }, [sortedTransactions]);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {/* ─── Page Header ─── */}
        <FadeIn className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="bg-brand shadow-glow flex size-12 items-center justify-center rounded-2xl text-primary-foreground">
              <WalletCardsIcon className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Wallet &amp; AI Usage</h1>
                <Badge variant="outline" className={healthStatus.badge}>
                  {healthStatus.label}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
                Pay-as-you-go generative tokens for <span className="font-semibold text-foreground">{ownerLabel}</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <CostEstimatorDialog currentBalance={balance} />
            <TopupGuideDialog walletId={wallet?.id ?? "school"} ownerLabel={ownerLabel} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={sortedTransactions.length === 0}
            >
              <DownloadIcon data-icon="inline-start" />
              Export CSV
            </Button>
          </div>
        </FadeIn>

        {/* ─── Load Failed Warning ─── */}
        {loadFailed && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-xl border p-4 text-sm">
            <ShieldAlertIcon className="size-5 shrink-0" />
            <div>
              <p className="font-semibold">Wallet data synchronization failed</p>
              <p className="text-xs opacity-90">
                Balances and ledgers shown below may be cached. Try refreshing your browser.
              </p>
            </div>
          </div>
        )}

        {/* ─── Executive KPI Cards Grid ─── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Available Token Balance (Hero) */}
          <div className="bg-brand shadow-glow relative col-span-1 flex flex-col justify-between overflow-hidden rounded-2xl p-5 text-primary-foreground sm:col-span-2 lg:col-span-2">
            <div
              className="pointer-events-none absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  "radial-gradient(28rem 16rem at 10% 0%, rgba(255,255,255,.6), transparent 70%)",
              }}
            />
            <div className="relative flex items-start justify-between">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-medium opacity-85">
                  <CoinsIcon className="size-3.5" />
                  Available Token Balance
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">
                    <AnimatedCounter value={balance} />
                  </span>
                  <span className="text-sm font-medium opacity-80">tokens</span>
                </div>
              </div>
              <Badge variant="secondary" className="bg-white/20 text-white backdrop-blur-md">
                {wallet?.ownerType === "school" ? "School Wallet" : "Personal Wallet"}
              </Badge>
            </div>

            <div className="relative mt-4 border-t border-white/15 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs opacity-90">
                <span>
                  Valuation: <strong className="font-semibold">{formatUsd(balanceUsd)}</strong> ({formatUgx(balanceUgx)})
                </span>
                <span>
                  ≈ <strong>{estimatedExamsPossible}</strong> exams capacity
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Total Top-ups (Inflow) */}
          <Card className="shadow-card flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-muted-foreground text-xs font-medium">
                  Total Credited (Lifetime)
                </CardTitle>
                <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex size-7 items-center justify-center rounded-lg">
                  <TrendingUpIcon className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold tabular-nums">
                  <AnimatedCounter value={totalTopup} />
                </span>
                <span className="text-muted-foreground text-xs">tokens</span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Value: <span className="font-medium text-foreground">{formatUsd(topupUsd)}</span> ({formatUgx(topupUgx)})
              </p>
            </CardContent>
            <CardFooter className="border-t bg-muted/20 py-2 text-[11px] text-muted-foreground">
              Across all historical admin credits
            </CardFooter>
          </Card>

          {/* Card 3: Total Consumed (Burn) */}
          <Card className="shadow-card flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-muted-foreground text-xs font-medium">
                  Total Consumed (Burned)
                </CardTitle>
                <span className="bg-violet-500/10 text-violet-600 dark:text-violet-400 flex size-7 items-center justify-center rounded-lg">
                  <TrendingDownIcon className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold tabular-nums">
                  <AnimatedCounter value={totalConsumed} />
                </span>
                <span className="text-muted-foreground text-xs">tokens</span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Value: <span className="font-medium text-foreground">{formatUsd(consumedUsd)}</span> ({formatUgx(consumedUgx)})
              </p>
            </CardContent>
            <CardFooter className="border-t bg-muted/20 py-2 text-[11px] text-muted-foreground">
              {transactions.filter((t) => t.tokensDelta < 0).length} generative executions recorded
            </CardFooter>
          </Card>
        </div>

        {/* ─── Quick Exchange Rate Banner ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3 text-xs backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full">
              <ZapIcon className="size-3" />
            </span>
            <span className="font-medium text-foreground">Standard AI Pricing:</span>
            <span className="text-muted-foreground">
              $0.027 per 1,000 text tokens · $0.08 per voice minute
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-[11px]">
              1 USD = 3,800 UGX
            </Badge>
            <span className="text-muted-foreground">Billed only on actual token generation</span>
          </div>
        </div>

        {/* ─── Transaction Ledger & Filters ─── */}
        <Card className="shadow-card overflow-hidden">
          <CardHeader className="border-b pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Transaction Ledger</CardTitle>
                <CardDescription className="text-xs">
                  Detailed history of AI generations, auto-gradings, voice interactions, and credit top-ups.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="font-mono">
                {sortedTransactions.length} {sortedTransactions.length === 1 ? "record" : "records"}
              </Badge>
            </div>

            {/* Filter Toolbar */}
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {/* Search Box */}
              <div className="relative min-w-48 flex-1 sm:max-w-xs">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  placeholder="Search description, ID, category…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 pl-8 text-xs"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Category Filter */}
              <Select
                value={categoryFilter}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setCategoryFilter(val);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="text_generation">Exam Generation</SelectItem>
                  <SelectItem value="grading">AI Grading</SelectItem>
                  <SelectItem value="voice">Voice Builder</SelectItem>
                  <SelectItem value="topup">Top-ups</SelectItem>
                  <SelectItem value="adjustment">Adjustments</SelectItem>
                </SelectContent>
              </Select>

              {/* Direction Filter */}
              <Select
                value={directionFilter}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setDirectionFilter(val as DirectionFilter);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectValue placeholder="All Flows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Flows (In &amp; Out)</SelectItem>
                  <SelectItem value="consumption">Deductions only</SelectItem>
                  <SelectItem value="topup">Credits only</SelectItem>
                </SelectContent>
              </Select>

              {/* Date Filter */}
              <Select
                value={dateFilter}
                onValueChange={(val: string | null) => {
                  if (val) {
                    setDateFilter(val as DateFilter);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>

              {/* Reset Filters */}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-8 text-xs">
                  <XIcon data-icon="inline-start" className="size-3.5" />
                  Clear filters
                </Button>
              )}
            </div>
          </CardHeader>

          {/* ─── Table ─── */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {/* Date & Time */}
                  <TableHead className="w-44 cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                    <div className="flex items-center gap-1.5">
                      <span>When</span>
                      {sortField === "createdAt" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>

                  {/* Category */}
                  <TableHead className="w-36 cursor-pointer select-none" onClick={() => handleSort("category")}>
                    <div className="flex items-center gap-1.5">
                      <span>Category</span>
                      {sortField === "category" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>

                  {/* Description */}
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("description")}>
                    <div className="flex items-center gap-1.5">
                      <span>Description</span>
                      {sortField === "description" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>

                  {/* Token Delta */}
                  <TableHead
                    className="w-36 cursor-pointer text-right select-none"
                    onClick={() => handleSort("tokensDelta")}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Tokens</span>
                      {sortField === "tokensDelta" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>

                  {/* Balance After */}
                  <TableHead
                    className="w-32 cursor-pointer text-right select-none"
                    onClick={() => handleSort("balanceAfter")}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Balance</span>
                      {sortField === "balanceAfter" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>

                  {/* Value */}
                  <TableHead
                    className="w-32 cursor-pointer text-right select-none"
                    onClick={() => handleSort("usdMicros")}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Value (USD/UGX)</span>
                      {sortField === "usdMicros" ? (
                        sortDir === "asc" ? (
                          <ChevronUpIcon className="size-3.5 text-primary" />
                        ) : (
                          <ChevronDownIcon className="size-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="text-muted-foreground/50 size-3" />
                      )}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {paginatedTransactions.map((t) => {
                  const isCredit = t.tokensDelta >= 0;
                  const categoryMeta = CATEGORY_CONFIG[t.category as TransactionCategory] ?? CATEGORY_CONFIG.text_generation;
                  const CategoryIcon = categoryMeta.icon;
                  const parsedDate = t.createdAt ? parseDate(t.createdAt) : null;
                  const usdVal = t.usdMicros > 0 ? t.usdMicros / 1_000_000 : 0;
                  const ugxVal = t.ugx ?? usdToUgx(usdVal);

                  return (
                    <TableRow key={t.id} className="transition-colors hover:bg-muted/40">
                      {/* Date & Time */}
                      <TableCell className="text-xs">
                        {parsedDate ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-default text-left">
                              <span className="font-medium text-foreground">
                                {format(parsedDate, "d MMM yyyy")}
                              </span>
                              <span className="text-muted-foreground block text-[11px]">
                                {format(parsedDate, "HH:mm:ss")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatDistanceToNow(parsedDate, { addSuffix: true })}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>

                      {/* Category Badge */}
                      <TableCell>
                        <Badge variant="outline" className={`gap-1 text-[11px] font-medium ${categoryMeta.badgeClass}`}>
                          <CategoryIcon className="size-3" />
                          {categoryMeta.label}
                        </Badge>
                      </TableCell>

                      {/* Description & Reference */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="max-w-md truncate font-medium text-foreground">
                            {t.description}
                          </span>
                          {t.refId && (
                            <span className="text-muted-foreground font-mono text-[10px]">
                              ref: {t.refId.slice(0, 12)}…
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Tokens Delta */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                            isCredit
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {isCredit ? (
                            <ArrowUpIcon className="size-3.5" />
                          ) : (
                            <ArrowDownIcon className="size-3.5" />
                          )}
                          {isCredit ? "+" : "-"}
                          {Math.abs(t.tokensDelta).toLocaleString()}
                        </span>
                      </TableCell>

                      {/* Balance After */}
                      <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                        {t.balanceAfter.toLocaleString()}
                      </TableCell>

                      {/* Monetary Value */}
                      <TableCell className="text-right tabular-nums">
                        {usdVal > 0 ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-default text-right">
                              <span className="font-mono text-xs font-semibold text-foreground">
                                {formatUsd(usdVal)}
                              </span>
                              <span className="text-muted-foreground block text-[10px]">
                                {formatUgx(ugxVal)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Standard billing cost: {formatUsd(usdVal)} (≈ {formatUgx(ugxVal)})
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {/* Empty State */}
                {paginatedTransactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-2">
                        <div className="bg-muted/50 flex size-12 items-center justify-center rounded-2xl">
                          <ReceiptIcon className="text-muted-foreground size-6" />
                        </div>
                        <p className="font-semibold text-foreground">No transactions found</p>
                        <p className="text-muted-foreground text-xs">
                          {hasActiveFilters
                            ? "No entries match your filter criteria. Try adjusting your search query."
                            : "Generate exams or configure AI agents to start seeing token activity."}
                        </p>
                        {hasActiveFilters && (
                          <Button variant="outline" size="sm" onClick={handleClearFilters} className="mt-2 text-xs">
                            Clear active filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* ─── Pagination Bar ─── */}
          {sortedTransactions.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Show</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v: string | null) => {
                    if (v) {
                      setPageSize(Number(v));
                      setPage(1);
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-16 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={String(opt)}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>
                  per page · Showing <strong>{startIndex + 1}</strong>–
                  <strong>{Math.min(startIndex + pageSize, sortedTransactions.length)}</strong> of{" "}
                  <strong>{sortedTransactions.length}</strong>
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(1)}
                  disabled={currentPage === 1}
                  className="size-7 p-0"
                >
                  <ChevronsLeftIcon className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="size-7 p-0"
                >
                  <ChevronLeftIcon className="size-3.5" />
                </Button>

                <span className="px-2 font-medium">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="size-7 p-0"
                >
                  <ChevronRightIcon className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="size-7 p-0"
                >
                  <ChevronsRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}
