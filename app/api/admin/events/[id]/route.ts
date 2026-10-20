// One event — user session, not service role.
//
// PATCH  → `update_event(p_event_id, p_title, p_location)`. Null = "leave unchanged",
//          so a partial body is valid. Ownership and status are not parameters.
// DELETE → `delete_event(p_event_id)`, refused with bookings (`event_has_bookings`).

import { requireUser } from "@/lib/auth";
import { deleteEvent, readJson, updateEvent } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ id: string }> };

/** PATCH /api/admin/events/[id]  body: { title?, location? } */
export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params;

  // Auth first: an anonymous caller must not learn whether an event id exists.
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  return updateEvent(guard.supabase, id, body);
}

/** DELETE /api/admin/events/[id] */
export async function DELETE(_request: Request, { params }: Props) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return deleteEvent(guard.supabase, id);
}
