import { configErrorResponse } from "@/lib/supabase";
import { fetchBookingByToken } from "@/lib/bookings";
import { buildIcs } from "@/lib/ics";

/**
 * GET /api/bookings/[ics_token]/calendar.ics — RFC 5545 calendar file.
 *
 * This is the whole "reminder" feature: no email infra, no cron, no API key.
 * DTSTART/DTEND are emitted in UTC (trailing Z); the calendar client renders
 * them in the viewer's timezone, which for a WIB client is the same wall clock
 * as Asia/Jakarta. UID is the ics_token so re-downloading updates one event
 * instead of creating duplicates.
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

    const startsAt = new Date(booking.slot.starts_at);
    const endsAt = new Date(booking.slot.ends_at);

    const ics = buildIcs({
      uid: booking.ics_token,
      startsAt,
      endsAt,
      summary: `Sesi Foto — ${booking.event.title}`,
      location: booking.event.location ?? undefined,
      description: [
        `Nama: ${booking.client_name}`,
        booking.photographer.display_name
          ? `Fotografer: ${booking.photographer.display_name}`
          : null,
        `Harga: Rp ${booking.slot.price_idr.toLocaleString("id-ID")}`,
        booking.notes ? `Catatan: ${booking.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="booking-${booking.ics_token}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("GET /api/bookings/[ics_token]/calendar.ics", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
