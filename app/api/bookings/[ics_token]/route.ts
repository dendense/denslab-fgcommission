import { configErrorResponse } from "@/lib/supabase";
import { fetchBookingByToken } from "@/lib/bookings";
import { googleCalendarUrl } from "@/lib/ics";

/**
 * GET /api/bookings/[ics_token] — confirmation data for the success page.
 *
 * The ics_token is the client's only credential (no accounts, no email), so it
 * is the entire access control for this route. Unknown token → 404, same as a
 * malformed one; no distinction that would help guessing.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ics_token: string }> },
) {
  const { ics_token } = await params;

  try {
    const booking = await fetchBookingByToken(ics_token);

    if (!booking) {
      return Response.json(
        { error: "not_found", message: "Booking tidak ditemukan." },
        { status: 404 },
      );
    }

    const calendarUrl = googleCalendarUrl({
      uid: booking.ics_token,
      startsAt: new Date(booking.slot.starts_at),
      endsAt: new Date(booking.slot.ends_at),
      summary: `Sesi Foto — ${booking.event.title}`,
      location: booking.event.location ?? undefined,
    });

    return Response.json(
      {
        ics_token: booking.ics_token,
        client_name: booking.client_name,
        notes: booking.notes,
        event: {
          title: booking.event.title,
          location: booking.event.location,
          slug: booking.event.slug,
        },
        photographer: {
          display_name: booking.photographer.display_name,
          contact_wa: booking.photographer.contact_wa,
        },
        slot: {
          starts_at: booking.slot.starts_at,
          ends_at: booking.slot.ends_at,
          price_idr: booking.slot.price_idr,
        },
        timezone: "Asia/Jakarta",
        calendar: {
          google_url: calendarUrl,
          ics_url: `/api/bookings/${booking.ics_token}/calendar.ics`,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("GET /api/bookings/[ics_token]", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
