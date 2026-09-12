// Version 1.1 (combined V1 + T45 R2 fallback) — shadow dashboard data.
//
// Read-only. This model has no dispatch path of any kind.
//
// The underlying query reads with the service role, so the server itself must
// prove the caller is signed in BEFORE any cached or privileged read happens.
// The client-side bearer attacher only ATTACHES a token; it validates nothing.
//
// The check is done in-handler (not via throwing middleware) so a momentarily
// missing session degrades the tile instead of blanking the whole page.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { buildV11Stats } from "./v11/statsQuery.server";
import { cachedStats } from "./statsCache.server";

async function isSignedIn(): Promise<boolean> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return false;

  const header = getRequest()?.headers?.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) return false;

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { apikey: key } },
    });
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data.user;
  } catch {
    return false;
  }
}

export const getV11Stats = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<string, any>> => {
    if (!(await isSignedIn())) {
      return { phase: "PREPARING", unauthorized: true };
    }
    return (await cachedStats("v11-stats", buildV11Stats, 15_000)) as Record<
      string,
      any
    >;
  },
);
