import type { Metadata } from "next";
import { AudioLinesIcon } from "lucide-react";

import { VoiceBuilder } from "@/components/features/admin/voice-builder";
import { AdminPageHeader } from "@/components/features/admin/admin-page-header";
import { BILLING } from "@/lib/constants";
import { formatUsd } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Voice Exam Builder | Bridge Admin",
  description:
    "Describe the exam you want out loud and watch the draft spec build live.",
};

/** Display rate sourced from BILLING so copy can't drift from the charge. */
const VOICE_RATE_LABEL = `${formatUsd(BILLING.usdPerVoiceMinute)}/min`;

export default function AdminVoicePage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        icon={<AudioLinesIcon className="size-5" />}
        eyebrow="Hands-free creation"
        title="Voice exam builder"
        description={`Talk to Bridge — describe the exam you want and watch the spec build live. Billed at ${VOICE_RATE_LABEL} from your school wallet.`}
        meta="Powered by the Gemini Live API"
      />
      <VoiceBuilder />
    </div>
  );
}
