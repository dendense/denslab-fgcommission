/**
 * The eight 0007 event/day writes, one function each, shared by every admin route.
 *
 * Two route families call in here — the `app/api/admin/events*` / `days*` paths and
 * the older `event-days` / `event-status` paths — so the RPC names, argument names
 * and validation live exactly once.
 *
 * `events` and `event_days` are read-only for `authenticated` since 0007; these RPCs
 * are the only doors. Every call runs on the caller's session client: `service_role`
 * has no `auth.uid()`, so `current_photographer_id()` is null there and every write
 * would come back `not_photographer`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { configErrorResponse } from "./supabase";
import { jsonError, rpcErrorResponse } from "./admin-errors";
import { listEvents } from "./admin-events";

// Local copy on purpose: lib/bookings.ts is the public booking path and imports the
// service-role client. Keeping it out of this module graph keeps service_role off
// the admin routes entirely.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const NO_STORE = { "Cache-Control": "no-store" };

type Json = Record<string, unknown>;

function str(body: Json, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

function optionalStr(body: Json, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v.trim() : null;
}

function invalid(name: string, message: string, status = 400): Response {
  return Response.json({ error: name, message }, { status });
}

function internal(tag: string, err: unknown): Response {
  const cfg = configErrorResponse(err);
  if (cfg) return cfg;
  console.error(tag, err);
  return Response.json({ error: "internal" }, { status: 500 });
}

function one(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

/** Shared body parse: `null` means "not JSON". */
export async function readJson(request: Request): Promise<Json | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- events

/** `create_event(p_title text, p_location text default null)` — status is always draft. */
export async function createEvent(supabase: SupabaseClient, body: Json): Promise<Response> {
  const title = str(body, "title");
  const location = optionalStr(body, "location");

  if (!title) return jsonError("invalid_title");

  try {
    const { data, error } = await supabase.rpc("create_event", {
      p_title: title,
      p_location: location || null,
    });

    if (error) return rpcErrorResponse(error);
    return Response.json({ event: one(data) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return internal("create_event", err);
  }
}

/** Every event owned by the caller. RLS (0004) does the filtering, not this code. */
export async function listOwnEvents(supabase: SupabaseClient): Promise<Response> {
  try {
    const events = await listEvents(supabase);
    return Response.json({ events }, { headers: NO_STORE });
  } catch (err) {
    return internal("listEvents", err);
  }
}

/** `update_event(p_event_id uuid, p_title text default null, p_location text default null)`. */
export async function updateEvent(
  supabase: SupabaseClient,
  eventId: string,
  body: Json,
): Promise<Response> {
  if (!UUID_RE.test(eventId)) return jsonError("event_not_found");

  const title = optionalStr(body, "title");
  const location = optionalStr(body, "location");

  if (title === null && location === null) {
    return invalid("invalid_request", "Tidak ada yang diubah.");
  }

  try {
    const { data, error } = await supabase.rpc("update_event", {
      p_event_id: eventId,
      p_title: title || null,
      p_location: location || null,
    });

    if (error) return rpcErrorResponse(error);
    return Response.json({ event: one(data) }, { headers: NO_STORE });
  } catch (err) {
    return internal("update_event", err);
  }
}

/** `delete_event(p_event_id uuid)` — refused with bookings (`event_has_bookings`). */
export async function deleteEvent(supabase: SupabaseClient, eventId: string): Promise<Response> {
  if (!UUID_RE.test(eventId)) return jsonError("event_not_found");

  try {
    const { error } = await supabase.rpc("delete_event", { p_event_id: eventId });

    if (error) return rpcErrorResponse(error);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return internal("delete_event", err);
  }
}

/**
 * `publish_event(p_event_id uuid)` / `unpublish_event(p_event_id uuid)`.
 * Publish refuses an event with no days (`no_days`); unpublish returns it to `draft`.
 */
export async function setPublished(
  supabase: SupabaseClient,
  eventId: string,
  published: boolean,
): Promise<Response> {
  if (!UUID_RE.test(eventId)) return jsonError("event_not_found");

  const fn = published ? "publish_event" : "unpublish_event";

  try {
    const { data, error } = await supabase.rpc(fn, { p_event_id: eventId });

    if (error) return rpcErrorResponse(error);
    return Response.json({ event: one(data) }, { headers: NO_STORE });
  } catch (err) {
    return internal(fn, err);
  }
}

// ---------------------------------------------------------------- days

/** `create_event_day(p_event_id uuid, p_day_date date, p_start_time time, p_end_time time)`. */
export async function createDay(
  supabase: SupabaseClient,
  eventId: string,
  body: Json,
): Promise<Response> {
  if (!UUID_RE.test(eventId)) return jsonError("event_not_found");

  const dayDate = str(body, "day_date");
  const startTime = str(body, "start_time");
  const endTime = str(body, "end_time");

  if (!DATE_RE.test(dayDate)) return invalid("invalid_date", "Tanggal harus format YYYY-MM-DD.");
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return invalid("invalid_time", "Jam harus format HH:MM.");
  }
  if (endTime.slice(0, 5) <= startTime.slice(0, 5)) {
    return invalid("invalid_time", "Jam selesai harus setelah jam mulai.");
  }

  try {
    const { data, error } = await supabase.rpc("create_event_day", {
      p_event_id: eventId,
      p_day_date: dayDate,
      p_start_time: startTime,
      p_end_time: endTime,
    });

    if (error) return rpcErrorResponse(error);
    return Response.json({ day: one(data) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return internal("create_event_day", err);
  }
}

/**
 * `update_event_day(p_event_day_id uuid, p_day_date date default null, p_start_time
 * time default null, p_end_time time default null)` — null means "leave unchanged",
 * so a partial body is valid.
 */
export async function updateDay(
  supabase: SupabaseClient,
  dayId: string,
  body: Json,
): Promise<Response> {
  if (!UUID_RE.test(dayId)) return jsonError("day_not_found");

  const dayDate = optionalStr(body, "day_date");
  const startTime = optionalStr(body, "start_time");
  const endTime = optionalStr(body, "end_time");

  if (dayDate === null && startTime === null && endTime === null) {
    return invalid("invalid_request", "Tidak ada yang diubah.");
  }
  if (dayDate !== null && !DATE_RE.test(dayDate)) {
    return invalid("invalid_date", "Tanggal harus format YYYY-MM-DD.");
  }
  for (const time of [startTime, endTime]) {
    if (time !== null && !TIME_RE.test(time)) {
      return invalid("invalid_time", "Jam harus format HH:MM.");
    }
  }
  if (startTime && endTime && endTime.slice(0, 5) <= startTime.slice(0, 5)) {
    return invalid("invalid_time", "Jam selesai harus setelah jam mulai.");
  }

  try {
    const { data, error } = await supabase.rpc("update_event_day", {
      p_event_day_id: dayId,
      p_day_date: dayDate,
      p_start_time: startTime,
      p_end_time: endTime,
    });

    if (error) return rpcErrorResponse(error);
    return Response.json({ day: one(data) }, { headers: NO_STORE });
  } catch (err) {
    return internal("update_event_day", err);
  }
}

/** `delete_event_day(p_event_day_id uuid)` — refused with a booked slot (`day_has_bookings`). */
export async function deleteDay(supabase: SupabaseClient, dayId: string): Promise<Response> {
  if (!UUID_RE.test(dayId)) return jsonError("day_not_found");

  try {
    const { error } = await supabase.rpc("delete_event_day", { p_event_day_id: dayId });

    if (error) return rpcErrorResponse(error);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return internal("delete_event_day", err);
  }
}
