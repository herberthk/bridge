/** Lightweight user-agent parsing for login analytics (no external deps). */

export interface ParsedUserAgent {
  browser: string;
  device: "desktop" | "tablet" | "mobile" | "unknown";
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { browser: "Unknown", device: "unknown" };

  let browser = "Unknown";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/samsungbrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/chrome\/|crios\//i.test(ua)) browser = "Chrome";
  else if (/firefox\/|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  let device: ParsedUserAgent["device"] = "desktop";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) {
    device = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) {
    device = "mobile";
  }

  return { browser, device };
}
