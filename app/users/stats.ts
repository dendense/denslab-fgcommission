import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfSchemaError } from "@/lib/db-errors";

/**
 * Row shape of `admin_photographer_stats(p_search text)` — see
 * supabase/migrations/0019_reject_delete_archive.sql (0010 created it, 0018 added
 * `instagram`, 0019 added `archived_at`). The keys are copied from that file's
 * `returns table (...)` list, not invented: PostgREST returns exactly those columns.
 *
 * `revenue_idr` is `sum(price_idr)` over *booked* slots only, and NULL when a photographer
 * has no booked slot (sum over zero rows). It is not money received — this project has no
 * payments table.
 *
 * `archived_at` null = active, non-null = archived. Archived rows are still returned: this
 * is the only screen where "unarchive" can live.
 */
export type PhotographerStat = {
  photographer_id: string;
  slug: string;
  display_name: string | null;
  contact_wa: string | null;
  instagram: string | null;
  email: string | null;
  has_account: boolean;
  events_total: number;
  events_published: number;
  events_done: number;
  slots_total: number;
  bookings_total: number;
  revenue_idr: number | null;
  last_event_at: string | null;
  archived_at: string | null;
};

/**
 * One row per photographer. Admin only — the RPC raises `not_admin` otherwise.
 *
 * `search` is the whole search: substring, case-insensitive, over display name OR email,
 * matched inside Postgres. Passing it as `p_search` instead of filtering rows in the
 * browser is the point of the RPC; empty/whitespace becomes `null` so every row returns.
 */
export async function readStats(
  supabase: SupabaseClient,
  search = "",
): Promise<PhotographerStat[]> {
  const term = search.trim();
  const { data, error } = await supabase.rpc("admin_photographer_stats", {
    p_search: term === "" ? null : term,
  });

  // PGRST202 (function missing) → DbNotMigratedError → the "belum siap" card.
  throwIfSchemaError(error);
  if (error) throw error;

  return (data ?? []) as PhotographerStat[];
}
