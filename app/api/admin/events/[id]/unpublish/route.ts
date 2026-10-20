// Unpublish an event — user session, not service role.
//
// `unpublish_event(p_event_id)` returns the event to `draft`, not `closed`: `closed`
// is a permanent closing with no reopening RPC, while unpublish must be repeatable.

import { requireUser } from "@/lib/auth";
import { setPublished } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ id: string }> };

/** POST /api/admin/events/[id]/unpublish */
export async function POST(_request: Request, { params }: Props) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return setPublished(guard.supabase, id, false);
}
