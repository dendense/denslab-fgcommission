import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { sessionClient } from "./auth";
import { throwIfSchemaError } from "./db-errors";

export type Studio = { id: string; slug: string; display_name: string | null };

/**
 * Session + studio row for an admin page. One place, so the three event pages cannot
 * drift on what "logged in" means.
 *
 * - no session          → /login
 * - no photographers row → /admin (it renders the "menunggu persetujuan" card, or the
 *                          admin panel for an admin who has no studio of his own)
 *
 * An admin without a studio row cannot own an event, so he is not let in here either —
 * every write path in 0007 resolves the owner through `current_photographer_id()`.
 * /admin is where he approves people; linking his account to a `photographers` row is
 * what unlocks creating events.
 *
 * "Do I own a studio?" is asked with `current_photographer_id()` (0004), NOT with a plain
 * select on `photographers`. Since 0010 added `photographers_admin_select`
 * (`using (is_admin())`), `.limit(1).maybeSingle()` returns *some other* photographer's row
 * for an admin — the gate would hand him a stranger's studio. The RPC is also the exact
 * predicate `create_event` / `create_event_day` (0007) use, so gate and write cannot
 * disagree. The row is then read by primary key, so it can only be the caller's own.
 */
export async function requireStudio(): Promise<{
  supabase: SupabaseClient;
  user: User;
  studio: Studio;
}> {
  const supabase = await sessionClient();

  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");

  const { data: studioId, error: idError } = await supabase.rpc("current_photographer_id");

  // Schema error → let the page render "belum siap" instead of a 500.
  throwIfSchemaError(idError);
  if (idError) throw idError;
  if (!studioId) redirect("/admin");

  const { data: me, error: meError } = await supabase
    .from("photographers")
    .select("id, slug, display_name")
    .eq("id", studioId)
    .maybeSingle();

  throwIfSchemaError(meError);
  if (meError) throw meError;
  if (!me) redirect("/admin");

  return { supabase, user: auth.user, studio: me as Studio };
}
