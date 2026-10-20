/**
 * RFC 5545 (.ics) generation. No dependency: the format is small and the
 * pieces we need (VEVENT, UTC DTSTART/DTEND, line folding) are a few lines.
 */

export type IcsEvent = {
  uid: string;
  /** Absolute instant. Always serialised to UTC in the output. */
  startsAt: Date;
  endsAt: Date;
  summary: string;
  location?: string;
  description?: string;
  /** Defaults to now. Injected in tests so output is deterministic. */
  now?: Date;
};

/** `YYYYMMDDTHHMMSSZ` in UTC — the only datetime form a calendar client reads reliably. */
export function formatUtc(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Escape per RFC 5545 §3.3.11: backslash, semicolon, comma, newline. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line at 75 octets (RFC 5545 §3.1). Continuation lines start
 * with a single space. Byte-based so multi-byte UTF-8 is not split mid-char.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not cut through a UTF-8 continuation byte (0b10xxxxxx).
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }

  return out.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rin Studio//Commission Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${formatUtc(ev.now ?? new Date())}`,
    `DTSTART:${formatUtc(ev.startsAt)}`,
    `DTEND:${formatUtc(ev.endsAt)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
  ];

  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  // RFC 5545 requires CRLF line endings.
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar "add event" template link. `dates` is UTC, no dashes or colons. */
export function googleCalendarUrl(ev: IcsEvent): string {
  const dates = `${formatUtc(ev.startsAt)}/${formatUtc(ev.endsAt)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.summary,
    dates,
    ...(ev.location ? { location: ev.location } : {}),
    ...(ev.description ? { details: ev.description } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
