// Edit or delete an event day — user session, not service role.
//
// Kept as the URL the event editor already calls. The RPC calls and validation live
// in lib/admin-event-ops.ts, shared with `app/api/admin/days/[dayId]`.

import { requireUser } from "@/lib/auth";
import { deleteDay, readJson, updateDay } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ dayId: string }> };

/** PATCH /api/admin/event-days/[dayId]  body: { day_date?, start_time?, end_time? } */
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

/** DELETE /api/admin/event-days/[dayId] */
export async function DELETE(_request: Request, { params }: Props) {
  const { dayId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return deleteDay(guard.supabase, dayId);
}
