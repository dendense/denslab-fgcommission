/** Shapes returned by the existing API routes — mirrors app/api/**, do not invent fields. */

export type SlotStatus = "open" | "booked" | "closed";

export type Slot = {
  id: string;
  seq: number;
  starts_at: string;
  ends_at: string;
  price_idr: number;
  status: SlotStatus;
};

export type EventDay = {
  id: string;
  day_date: string;
  start_time: string;
  end_time: string;
  slots: Slot[];
};

export type PublicEvent = {
  event: { id: string; slug: string; title: string; location: string | null; status: string };
  photographer: { display_name: string | null; contact_wa: string | null };
  days: EventDay[];
  timezone: string;
};

export type BookingDetail = {
  ics_token: string;
  client_name: string;
  notes: string | null;
  event: { title: string; location: string | null; slug: string };
  photographer: { display_name: string | null; contact_wa: string | null };
  slot: { starts_at: string; ends_at: string; price_idr: number };
  timezone: string;
};

export type BookingCreated = {
  ics_token: string;
  confirmation_url: string;
  calendar_ics_url: string;
};

export type ApiError = { error: string; message: string; field?: string };
