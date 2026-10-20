import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { sessionClient } from "./auth";

export type Studio = { id: string; slug: string; display_name: string | null };

/**
 * Session + studio row for an admin page. One place, so the three event pages cannot
 * drift on what "logged in" means.
 *
 * - no session          → /login
 * - no photographers row → /admin (it renders the "menunggu persetujuan" card)
 *
 * RLS (0004) scopes the photographers select to the caller's own row, so this can only
 * ever return the caller's studio.
 */
export async function requireStudio(): Promise<{
  supabase: SupabaseClient;
  user: User;
  studio: Studio;
}> {
  const supabase = await sessionClient();

  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");

  const { data: me, error: meError } = await supabase
    .from("photographers")
    .select("id, slug, display_name")
    .limit(1)
    .maybeSingle();

  if (meError) throw meError;
  if (!me) redirect("/admin");

  return { supabase, user: auth.user, studio: me as Studio };
}
