/**
 * Admin reads for the event list and the event editor.
 *
 * Plain PostgREST selects on the session client — not a new RPC. Since 0007 revoked
 * only INSERT/UPDATE/DELETE on `events` and `event_days`, `select` still works, and the
 * RLS policies from 0004 (`events_owner_select`, `event_days_owner_select`,
 * `slots_owner_select`) already scope every row to `current_photographer_id()`.
 *
 * The nested select is one round trip: events → event_days → slots. PostgREST applies
 * RLS at every level, so a foreign event cannot leak through the embed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlotStatus } from "./types";

export type AdminSlot = {
  id: string;
  seq: number;
  starts_at: string;
  ends_at: string;
  price_idr: number;
  status: SlotStatus;
};

export type AdminDay = {
  id: string;
  day_date: string;
  start_time: string;
  end_time: string;
  slots: AdminSlot[];
};

export type AdminEvent = {
  id: string;
  title: string;
  location: string | null;
  status: "draft" | "published" | "closed";
  created_at: string;
  event_days: AdminDay[];
};

const SHAPE =
  "id,title,location,status,created_at,event_days(id,day_date,start_time,end_time,slots(id,seq,starts_at,ends_at,price_idr,status))";

/** Every event owned by the caller, newest first. */
export async function listEvents(supabase: SupabaseClient): Promise<AdminEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(SHAPE)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as AdminEvent[];
}

/** One event by id, or null when it does not exist or is not the caller's. */
export async function getEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<AdminEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select(SHAPE)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as AdminEvent | null) ?? null;
}

/** Slot totals for the list row. */
export function slotCounts(event: AdminEvent): { total: number; booked: number } {
  const slots = (event.event_days ?? []).flatMap((d) => d.slots ?? []);
  return {
    total: slots.length,
    booked: slots.filter((s) => s.status === "booked").length,
  };
}

/** Earliest day date, for the list row. */
export function firstDayDate(event: AdminEvent): string | null {
  const dates = (event.event_days ?? []).map((d) => d.day_date).sort();
  return dates[0] ?? null;
}

export type PublishedRef = { id: string; title: string; created_at: string };

/**
 * Every `published` event of the caller, newest first.
 *
 * `public_event` (0001) picks exactly one: `where p.slug = p_slug and
 * e.status = 'published' order by e.created_at desc limit 1`. So the first row here is
 * the event `/e/[slug]` is actually serving — the editor shows that out loud when there
 * is more than one, because "terbit" would otherwise read as "tampil".
 */
export async function listPublished(supabase: SupabaseClient): Promise<PublishedRef[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id,title,created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as PublishedRef[];
}
