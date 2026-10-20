import { serviceClient } from "./supabase";

/**
 * One booking, looked up by its ics_token — the client's only credential.
 *
 * Goes through the `booking_by_token` RPC instead of a PostgREST embed: the
 * embed would need several join levels and would silently change shape if a
 * relation were renamed. The RPC returns exactly one jsonb row or null.
 */

export type BookingDetail = {
  ics_token: string;
  client_name: string;
  notes: string | null;
  created_at: string;
  slot: {
    id: string;
    starts_at: string;
    ends_at: string;
    price_idr: number;
  };
  event: {
    title: string;
    location: string | null;
    slug: string;
  };
  photographer: {
    display_name: string | null;
    contact_wa: string | null;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Unknown token and malformed token must both come back as null: the route
 * turns either into the same 404, so a prober learns nothing from the shape.
 */
export async function fetchBookingByToken(token: string): Promise<BookingDetail | null> {
  if (!isUuid(token)) return null;

  const { data, error } = await serviceClient().rpc("booking_by_token", { p_token: token });

  if (error) throw error;
  return (data as BookingDetail | null) ?? null;
}
