import React from "react";
import { Text } from "@react-email/components";

import { EmailLayout } from "./layout";

export function StudentInviteEmail({
  displayName,
  email,
  temporaryPassword,
  loginUrl,
}: {
  displayName: string;
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}) {
  return (
    <EmailLayout
      preview="Your Bridge student account is ready"
      heading={`Welcome to Bridge, ${displayName}!`}
      footer="Bridge — AI-powered assessment for Ugandan schools."
    >
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Your teacher has created a Bridge account for you. Sign in with the
        details below to see your exams, take AI-proctored tests, and get
        instant feedback.
      </Text>
      <Text style={{ background: "#f4f4f8", borderRadius: 8, padding: 16, fontSize: 14 }}>
        <strong>Sign-in email:</strong> {email}
        <br />
        <strong>Temporary password:</strong>{" "}
        <span style={{ fontFamily: "monospace" }}>{temporaryPassword}</span>
      </Text>
      <Text style={{ fontSize: 13, color: "#8b8b9a" }}>
        For security, change your password after your first sign-in at{" "}
        <a href={loginUrl} style={{ color: "#4f46e5" }}>
          {loginUrl}
        </a>
        .
      </Text>
    </EmailLayout>
  );
}

export function ExamResultsEmail({
  displayName,
  examTitle,
  score,
  resultUrl,
}: {
  displayName: string;
  examTitle: string;
  score: { earned: number; possible: number; percentage: number };
  resultUrl: string;
}) {
  return (
    <EmailLayout
      preview={`Your results for ${examTitle} are ready`}
      heading="Your results are in 🎉"
    >
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Hi {displayName}, your exam <strong>{examTitle}</strong> has been
        graded.
      </Text>
      <Text
        style={{
          background: "linear-gradient(135deg, #eef2ff, #faf5ff)",
          borderRadius: 8,
          padding: 20,
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: 34, fontWeight: 700, color: "#4f46e5" }}>
          {score.percentage}%
        </span>
        <br />
        <span style={{ fontSize: 13, color: "#8b8b9a" }}>
          {score.earned} of {score.possible} marks
        </span>
      </Text>
      <Text style={{ fontSize: 14 }}>
        Review per-question feedback and AI study tips:{" "}
        <a href={resultUrl} style={{ color: "#4f46e5" }}>
          {resultUrl}
        </a>
      </Text>
    </EmailLayout>
  );
}

export function BanNoticeEmail({
  displayName,
  reason,
  adminContact,
}: {
  displayName: string;
  reason: string;
  adminContact: string;
}) {
  return (
    <EmailLayout
      preview="Your Bridge account has been banned"
      heading="Account suspended from exams"
      footer="Bridge exam-integrity notice."
    >
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Hi {displayName}, your Bridge account has been banned following an
        exam-integrity review.
      </Text>
      <Text
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 8,
          padding: 14,
          fontSize: 14,
          color: "#991b1b",
        }}
      >
        <strong>Reason:</strong> {reason}
      </Text>
      <Text style={{ fontSize: 14 }}>
        If you believe this was a mistake, contact your administrator at{" "}
        <a href={`mailto:${adminContact}`} style={{ color: "#4f46e5" }}>
          {adminContact}
        </a>
        .
      </Text>
    </EmailLayout>
  );
}

export function TeacherInviteEmail({
  displayName,
  schoolName,
  invitedByName,
  inviteUrl,
  expiresAt,
}: {
  displayName: string;
  schoolName: string;
  invitedByName: string | null;
  inviteUrl: string;
  expiresAt: Date;
}) {
  return (
    <EmailLayout
      preview={`You've been invited to teach at ${schoolName} on Bridge`}
      heading={`Join ${schoolName} on Bridge`}
      footer="Bridge — AI-powered assessment for Ugandan schools."
    >
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Hi {displayName || "there"}, {invitedByName ?? "a school admin"} has
        invited you to join <strong>{schoolName}</strong> as a teacher on
        Bridge — the AI-powered assessment platform.
      </Text>
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Accept your invite to set up your account, see your classes, generate
        AI exams and track your students&apos; performance.
      </Text>
      <Text style={{ textAlign: "center", margin: "24px 0" }}>
        <a
          href={inviteUrl}
          style={{
            background: "#4f46e5",
            color: "#ffffff",
            borderRadius: 10,
            padding: "12px 28px",
            fontSize: 15,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Accept invitation
        </a>
      </Text>
      <Text style={{ fontSize: 13, color: "#8b8b9a" }}>
        This link is personal and expires on{" "}
        {expiresAt.toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        . If the button doesn&apos;t work, paste this into your browser:{" "}
        <a href={inviteUrl} style={{ color: "#4f46e5", wordBreak: "break-all" }}>
          {inviteUrl}
        </a>
      </Text>
    </EmailLayout>
  );
}

export function InviteRevokedEmail({ schoolName }: { schoolName: string }) {
  return (
    <EmailLayout
      preview={`Your Bridge invite to ${schoolName} was revoked`}
      heading="Invitation revoked"
      footer="Bridge — AI-powered assessment for Ugandan schools."
    >
      <Text style={{ fontSize: 15, color: "#3f3f4a" }}>
        Your invitation to join <strong>{schoolName}</strong> on Bridge has been
        revoked by the school administration and the link is no longer active.
      </Text>
      <Text style={{ fontSize: 14, color: "#8b8b9a" }}>
        If you think this was a mistake, contact the school&apos;s administration —
        they can send you a fresh invitation.
      </Text>
    </EmailLayout>
  );
}
