// POST /api/admin/users/events  →  admin_create_event_for_photographer(p_photographer_id, p_title, p_location)
//
// Separate path from POST /api/admin/events on purpose: that route calls `create_event`,
// whose owner comes from `current_photographer_id()` (the caller's own studio). This one
// takes the photographer from the body and is the only way an admin without a studio can
// create an event at all. Keeping them apart means the photographer path cannot regress
// into "create for whoever the body says".
//
// Status is not a parameter: 0010 always inserts `draft`.

import { requireAdmin } from "@/lib/auth";
import { readJson } from "@/lib/admin-event-ops";
import { jsonError, rpc0010Error } from "../_errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  const photographerId = typeof body.photographer_id === "string" ? body.photographer_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";

  // A malformed id is the same answer as a missing photographer — 0010 uses
  // photographer_not_found for both, so the route does too instead of inventing a code.
  if (!UUID_RE.test(photographerId)) return jsonError("photographer_not_found");
  if (!title) return jsonError("invalid_title");

  try {
    const { data, error } = await guard.supabase.rpc("admin_create_event_for_photographer", {
      p_photographer_id: photographerId,
      p_title: title,
      p_location: location || null,
    });

    if (error) return rpc0010Error(error);

    const event = Array.isArray(data) ? data[0] : data;
    return Response.json({ event }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("admin_create_event_for_photographer", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
