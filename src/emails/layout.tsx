import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import React from "react";

const brand = "#4f46e5";

export function EmailLayout({
  preview,
  heading,
  children,
  footer,
}: {
  preview: string;
  heading: string;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f4f4f8", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "24px" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 12, maxWidth: 520, overflow: "hidden" }}>
          <Section style={{ background: `linear-gradient(135deg, ${brand}, #9333ea)`, padding: "28px 32px" }}>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, margin: 0 }}>
              ⚡ Bridge
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, margin: "4px 0 0" }}>
              AI-powered assessment platform
            </Text>
          </Section>
          <Section style={{ padding: "28px 32px" }}>
            <Heading as="h1" style={{ fontSize: 20, margin: "0 0 16px" }}>
              {heading}
            </Heading>
            {children}
            <Hr style={{ borderColor: "#e4e4ec", margin: "24px 0 16px" }} />
            <Text style={{ color: "#8b8b9a", fontSize: 12 }}>
              {footer ?? "You received this email because you have a Bridge account."}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export { Button, Section, Text };
