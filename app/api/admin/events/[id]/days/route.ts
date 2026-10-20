// Add a day to an event — user session, not service role.
//
// `create_event_day(p_event_id, p_day_date, p_start_time, p_end_time)`. A second day
// with the same date is refused (`duplicate_day`) — 0001 has no unique constraint for
// that, so the check lives in the function.

import { requireUser } from "@/lib/auth";
import { createDay, readJson } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ id: string }> };

/** POST /api/admin/events/[id]/days  body: { day_date: "YYYY-MM-DD", start_time: "HH:MM", end_time: "HH:MM" } */
export async function POST(request: Request, { params }: Props) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  return createDay(guard.supabase, id, body);
}
