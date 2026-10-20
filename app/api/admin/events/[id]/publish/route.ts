// Publish an event — user session, not service role.
//
// `publish_event(p_event_id)` refuses an event with no days (`no_days`): a published
// event with an empty schedule is a public page that tells clients nothing. It takes
// only the id, so `status` can never arrive as a free-form body value.

import { requireUser } from "@/lib/auth";
import { setPublished } from "@/lib/admin-event-ops";

type Props = { params: Promise<{ id: string }> };

/** POST /api/admin/events/[id]/publish */
export async function POST(_request: Request, { params }: Props) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return setPublished(guard.supabase, id, true);
}
