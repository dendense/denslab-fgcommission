// One event day — user session, not service role.
//
// PATCH  → `update_event_day(p_event_day_id, p_day_date, p_start_time, p_end_time)`.
//          Null = "leave unchanged"; `event_id` is not a parameter, so a day cannot be
//          moved to another event (that would move the client's slots with it).
// DELETE → `delete_event_day(p_event_day_id)`, refused with a booked slot
//          (`day_has_bookings`): slots and bookings cascade, so the client's booking
//          would vanish without a trace.

import { requireUser } from "@/lib/auth";
import { deleteDay, readJson, updateDay } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ dayId: string }> };

/** PATCH /api/admin/days/[dayId]  body: { day_date?, start_time?, end_time? } */
export async function PATCH(request: Request, { params }: Props) {
  const { dayId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  return updateDay(guard.supabase, dayId, body);
}

/** DELETE /api/admin/days/[dayId] */
export async function DELETE(_request: Request, { params }: Props) {
  const { dayId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return deleteDay(guard.supabase, dayId);
}
