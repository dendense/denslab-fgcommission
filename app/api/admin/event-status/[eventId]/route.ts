// Publish / unpublish an event — user session, not service role.
//
// Kept as the URL the event editor already calls (`{ action: "publish" | "unpublish" }`).
// The RPC calls live in lib/admin-event-ops.ts, shared with
// `POST /api/admin/events/[id]/publish` and `.../unpublish`.

import { requireUser } from "@/lib/auth";
import { readJson, setPublished } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ eventId: string }> };

/** POST /api/admin/event-status/[eventId]  body: { action: "publish" | "unpublish" } */
export async function POST(request: Request, { params }: Props) {
  const { eventId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) {
    return Response.json({ error: "invalid_request", message: "Body harus JSON." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "publish" && action !== "unpublish") {
    return Response.json(
      { error: "invalid_request", message: 'action harus "publish" atau "unpublish".' },
      { status: 400 },
    );
  }

  return setPublished(guard.supabase, eventId, action === "publish");
}
