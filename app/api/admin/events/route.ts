// Events collection — user session, not service role.
//
// GET  → every event owned by the caller. Plain select, because 0007 revoked only
//        INSERT/UPDATE/DELETE on `events`: `select` still works and the 0004 policy
//        `events_owner_select` does the filtering.
// POST → `create_event(p_title, p_location)`. No photographer id and no status in
//        the body: the owner comes from `current_photographer_id()` and the status
//        is always `draft`.

import { requireUser } from "@/lib/auth";
import { createEvent, listOwnEvents, readJson } from "@/lib/admin-event-ops";

/** GET /api/admin/events */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return listOwnEvents(guard.supabase);
}

/** POST /api/admin/events  body: { title: string, location?: string | null } */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  return createEvent(guard.supabase, body);
}
