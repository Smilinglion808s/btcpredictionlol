import { createFileRoute, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      // No sign-in required — silently provision an anonymous session
      // so server functions guarded by requireSupabaseAuth still work.
      await supabase.auth.signInAnonymously();
    }
    const { data: after } = await supabase.auth.getUser();
    return { user: after.user };
  },
  component: () => <Outlet />,
});
