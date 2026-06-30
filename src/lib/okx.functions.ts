import { createServerFn } from "@tanstack/react-start";
import { fetchAndUpsertOkxCandles } from "./okx.server";

export const fetchOkxCandles = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return fetchAndUpsertOkxCandles(supabaseAdmin);
});
