"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { TOPUP_PACKS } from "@/lib/pricing";
import { formatTokens, formatUsd, formatUgx, tokensToUsd, usdToUgx } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Self-serve pay-as-you-go credit. Picks a pack (or a custom amount), creates
 * a top-up + checkout session via /api/topups, then redirects to the hosted
 * checkout page. Real gateways slot in behind the same call.
 */
export function AddCreditDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [customTokens, setCustomTokens] = useState<number | null>(null);
  const [selectedPack, setSelectedPack] = useState<number>(TOPUP_PACKS[0].tokens);

  const tokens = customTokens ?? selectedPack;
  const usd = tokensToUsd(tokens);
  const ugx = usdToUgx(usd);

  const startCheckout = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens,
          packId: customTokens === null ? String(selectedPack) : undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; redirectUrl: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        toast.error(data && "error" in data ? data.error : "Could not start checkout.");
        return;
      }
      router.push(data.redirectUrl);
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setCustomTokens(null); }}>
      <DialogTrigger render={<Button className="shadow-glow" />}>
        <PlusIcon data-icon="inline-start" />
        Add credit
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="text-primary size-4" />
            Add wallet credit
          </DialogTitle>
          <DialogDescription>
            Pay-as-you-go tokens for AI exam generation and grading. The UGX
            price follows the platform rate (1 USD = 3,800 UGX).
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-2">
            {TOPUP_PACKS.map((pack) => {
              const active = customTokens === null && selectedPack === pack.tokens;
              return (
                <button
                  type="button"
                  key={pack.tokens}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedPack(pack.tokens);
                    setCustomTokens(null);
                  }}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-primary/30 ring-2"
                      : "hover:bg-accent/60",
                  )}
                >
                  <p className="text-sm font-semibold">{pack.label}</p>
                  <p className="text-primary text-sm font-medium tabular-nums">
                    {formatTokens(pack.tokens)} tokens
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatUsd(tokensToUsd(pack.tokens))} · {formatUgx(usdToUgx(tokensToUsd(pack.tokens)))}
                  </p>
                </button>
              );
            })}
          </div>
          <Field>
            <FieldLabel htmlFor="custom-tokens">Custom amount (optional)</FieldLabel>
            <Input
              id="custom-tokens"
              type="number"
              min={1000}
              step={1000}
              placeholder="e.g. 250000"
              value={customTokens ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCustomTokens(Number.isFinite(n) && n >= 1000 ? n : null);
              }}
            />
            <FieldDescription>
              {formatTokens(tokens)} tokens → {formatUsd(usd)} ≈ {formatUgx(ugx)}
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void startCheckout()} disabled={starting}>
              {starting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                  Opening checkout…
                </>
              ) : (
                "Continue to payment"
              )}
            </Button>
          </DialogFooter>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
