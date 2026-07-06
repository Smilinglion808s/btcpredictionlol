import { createServerFn } from "@tanstack/react-start";
import { fetchAndUpsertOkxCandles } from "./okx.server";

export const fetchOkxCandles = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = await fetchAndUpsertOkxCandles(supabaseAdmin);
  return rows as unknown as Array<Record<string, string | number | boolean | null>>;
});
