import { configErrorResponse, serviceClient } from "@/lib/supabase";
import { isUuid } from "@/lib/bookings";

/**
 * POST /api/bookings
 * body: { slot_id, client_name, client_wa, notes? }
 *
 * Atomic: the slot flip and the booking insert happen inside one Postgres
 * function (`book_slot`), never as read-then-write from here.
 */

type Body = {
  slot_id?: unknown;
  client_name?: unknown;
  client_wa?: unknown;
  notes?: unknown;
};

/** Indonesian mobile: 08xxxxxxxxxx, +628xxxxxxxxxx, or 628xxxxxxxxxx. */
function normaliseWa(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  const m = /^(?:\+62|62|0)8\d{7,12}$/.exec(digits);
  if (!m) return null;
  const national = digits.replace(/^(\+62|62|0)/, "");
  return `62${national}`;
}

function badRequest(message: string, field?: string) {
  return Response.json({ error: "invalid_request", message, field }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("Body harus JSON.");
  }

  const slotId = typeof body.slot_id === "string" ? body.slot_id.trim() : "";
  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  const clientWaRaw = typeof body.client_wa === "string" ? body.client_wa.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!isUuid(slotId)) return badRequest("slot_id tidak valid.", "slot_id");
  if (clientName.length < 2 || clientName.length > 80) {
    return badRequest("Nama harus 2–80 karakter.", "client_name");
  }

  const clientWa = normaliseWa(clientWaRaw);
  if (!clientWa) {
    return badRequest("Nomor WhatsApp tidak valid. Contoh: 081234567890.", "client_wa");
  }

  if (notes.length > 500) return badRequest("Catatan maksimal 500 karakter.", "notes");

  try {
    const supabase = serviceClient();

    const { data, error } = await supabase.rpc("book_slot", {
      p_slot_id: slotId,
      p_client_name: clientName,
      p_client_wa: clientWa,
      p_notes: notes || null,
    });

    if (error) {
      // Raised by book_slot when the UPDATE matched no row: the slot was taken
      // (or closed) between the page load and this submit.
      if (error.code === "P0001" || /slot_unavailable/.test(error.message ?? "")) {
        return Response.json(
          {
            error: "slot_unavailable",
            message: "Slot ini baru saja diambil. Silakan pilih slot lain.",
          },
          { status: 409 },
        );
      }
      console.error("book_slot failed", error);
      return Response.json(
        { error: "server_error", message: "Gagal menyimpan booking. Coba lagi." },
        { status: 500 },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ics_token) {
      console.error("book_slot returned no token", data);
      return Response.json(
        { error: "server_error", message: "Gagal menyimpan booking. Coba lagi." },
        { status: 500 },
      );
    }

    return Response.json(
      {
        ics_token: row.ics_token as string,
        confirmation_url: `/booking/${row.ics_token}`,
        calendar_ics_url: `/api/bookings/${row.ics_token}/calendar.ics`,
      },
      { status: 201 },
    );
  } catch (err) {
    const cfg = configErrorResponse(err);
    if (cfg) return cfg;
    console.error("POST /api/bookings", err);
    return Response.json(
      { error: "server_error", message: "Terjadi kesalahan di server." },
      { status: 500 },
    );
  }
}
