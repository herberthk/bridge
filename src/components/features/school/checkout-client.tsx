"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CreditCardIcon, Loader2Icon, LockIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { formatTokens, formatUgx, formatUsd } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

/**
 * Buyer-side simulated gateway page. The mock PaymentProvider's redirect URL
 * points here; a real provider would host this page instead. On confirm, the
 * top-up is marked completed and the wallet credited server-side.
 */
export function CheckoutClient({
  topupId,
  tokens,
  amountUgx,
  amountUsd,
  walletLabel,
  schoolName,
}: {
  topupId: string;
  tokens: number;
  amountUgx: number;
  amountUsd: number;
  walletLabel: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"form" | "paying" | "done">("form");

  const confirm = async () => {
    setStatus("paying");
    try {
      const res = await fetch(`/api/topups/${topupId}/complete`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        toast.error(data && "error" in data ? data.error : "Payment failed.");
        setStatus("form");
        return;
      }
      setStatus("done");
      toast.success(`${formatTokens(tokens)} tokens credited to ${walletLabel}!`);
      setTimeout(() => router.push("/admin/wallet"), 1600);
    } catch {
      toast.error("Network error — try again.");
      setStatus("form");
    }
  };

  const cancel = async () => {
    await fetch(`/api/topups/${topupId}/cancel`, { method: "POST" }).catch(() => undefined);
    router.push("/admin/wallet");
  };

  if (status === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <CheckCircle2Icon className="size-8" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight">Payment successful</h2>
        <p className="text-muted-foreground text-sm">
          {formatTokens(tokens)} tokens are now available on your wallet.
          Redirecting…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Order summary */}
      <div className="bg-muted/50 rounded-2xl border p-5">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Order summary
        </p>
        <div className="mt-3 flex items-baseline justify-between">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatUgx(amountUgx)}</p>
            <p className="text-muted-foreground text-sm">≈ {formatUsd(amountUsd)}</p>
          </div>
          <div className="text-right">
            <p className="text-primary text-lg font-semibold tabular-nums">
              {formatTokens(tokens)}
            </p>
            <p className="text-muted-foreground text-xs">AI tokens</p>
          </div>
        </div>
        <Separator className="my-4" />
        <dl className="text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Merchant</dt>
            <dd className="font-medium">Bridge Assessment Platform</dd>
          </div>
          <div className="mt-1.5 flex justify-between">
            <dt className="text-muted-foreground">Billed to</dt>
            <dd className="font-medium">{schoolName}</dd>
          </div>
          <div className="mt-1.5 flex justify-between">
            <dt className="text-muted-foreground">Crediting</dt>
            <dd className="font-medium">{walletLabel}</dd>
          </div>
        </dl>
      </div>

      {/* Simulated card form */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CreditCardIcon className="size-4" />
          Card details
          <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
            Simulated
          </span>
        </div>
        <Input placeholder="4242 4242 4242 4242" disabled />
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="MM / YY" disabled />
          <Input placeholder="CVC" disabled />
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <LockIcon className="size-3" />
          Real payment gateways (Flutterwave / Stripe / MTN MoMo) will be
          integrated here — this checkout safely simulates one for now.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => void cancel()} disabled={status === "paying"}>
          <XIcon data-icon="inline-start" />
          Cancel
        </Button>
        <Button className="flex-1 shadow-glow" onClick={() => void confirm()} disabled={status === "paying"}>
          {status === "paying" ? (
            <>
              <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              Processing…
            </>
          ) : (
            <>
              <ShieldCheckIcon data-icon="inline-start" />
              Pay {formatUgx(amountUgx)}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
