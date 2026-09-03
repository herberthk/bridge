const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** Cryptographically random pick from `alphabet`. */
function pick(alphabet: string): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return alphabet[(bytes[0] ?? 0) % alphabet.length] ?? "x";
}

/**
 * Temporary password meeting the account policy (10+ chars with
 * upper/lowercase and a number). Ambiguous glyphs (0/O, 1/l) are excluded so
 * a password read off a screen still types correctly.
 */
export function generateTempPassword(length = 12): string {
  if (!Number.isFinite(length)) {
    throw new RangeError("Temporary password length must be finite.");
  }
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  const all = LOWER + UPPER + DIGITS;
  while (chars.length < Math.max(length, 10)) chars.push(pick(all));
  // Fisher–Yates so the guaranteed classes aren't always in front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = (bytes[0] ?? 0) % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
