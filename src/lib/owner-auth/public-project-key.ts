import { PROVIDER_URL } from "./owner-login";
const PROJECT_REF = new URL(PROVIDER_URL).hostname.split(".")[0];
/** Configuration classification ONLY. This is NOT JWT signature verification or user authorization.
 * An accepted legacy anon key remains a public project key; the provider must validate it.
 */
export function isPublicProjectKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{12,512}$/.test(value)) return true;
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    !parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p)) ||
    parts[2].length !== 43
  )
    return false;
  const decode = (
    part: string,
    keys: readonly string[],
  ): Record<string, unknown> | null => {
    if (part.length > 2048) return null;
    try {
      const raw = atob(
        part.replaceAll("-", "+").replaceAll("_", "/") +
          "=".repeat((4 - (part.length % 4)) % 4),
      );
      if (raw.length > 1024 || /[^\x20-\x7e]/.test(raw) || raw.includes("\\"))
        return null;
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const record = data as Record<string, unknown>;
      if (Object.keys(record).sort().join(",") !== [...keys].sort().join(","))
        return null;
      // Reject duplicate/escaped keys instead of relying on a parser's duplicate-key convention.
      if (
        !keys.every(
          (key) =>
            [...raw.matchAll(new RegExp('"' + key + '"\\s*:', "g"))].length ===
            1,
        )
      )
        return null;
      return record;
    } catch {
      return null;
    }
  };
  const header = decode(parts[0], ["alg", "typ"]);
  const claims = decode(parts[1], ["iss", "ref", "role", "iat", "exp"]);
  return (
    !!header &&
    !!claims &&
    header.alg === "HS256" &&
    header.typ === "JWT" &&
    claims.iss === "supabase" &&
    claims.ref === PROJECT_REF &&
    claims.role === "anon" &&
    Number.isSafeInteger(claims.iat) &&
    (claims.iat as number) >= 0 &&
    Number.isSafeInteger(claims.exp) &&
    (claims.exp as number) > (claims.iat as number)
  );
}
