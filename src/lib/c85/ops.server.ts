// Minimal signed-hook helpers still used by the V3 recorder.
// (The former C85/Lite-A/V1.1 worker operations were removed.)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serviceClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Single-use nonce. Returns false when this exact request was already accepted. */
export async function claimNonce(
  supabase: SupabaseClient,
  nonce: string,
  op: string,
  workerId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("c85_request_nonces")
    .insert({ nonce, op, worker_id: workerId });
  if (!error) return true;
  if (String(error.code) === "23505") return false;
  throw new Error(error.message);
}
