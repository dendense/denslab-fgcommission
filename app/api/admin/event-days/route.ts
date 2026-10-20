// Add a day to an event — user session, not service role.
//
// Kept as the URL the event editor already calls. The RPC call, argument names and
// validation live in lib/admin-event-ops.ts, shared with
// `POST /api/admin/events/[id]/days`; this file only picks the event id out of the
// body, which the nested route takes from the path instead.

import { requireUser } from "@/lib/auth";
import { createDay, readJson } from "@/lib/admin-event-ops";

/** POST /api/admin/event-days  body: { event_id, day_date, start_time, end_time } */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  return createDay(guard.supabase, eventId, body);
}
