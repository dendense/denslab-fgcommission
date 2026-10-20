/**
 * Self-check for lib/ics.ts — runnable without a framework:
 *   node --experimental-strip-types scripts/check-ics.ts
 * (Node 24 strips types natively; no tsx/ts-node dependency.)
 *
 * Covers the one thing that is easy to get silently wrong: WIB → UTC.
 */
import assert from "node:assert/strict";
import { buildIcs, formatUtc, googleCalendarUrl } from "../lib/ics.ts";

// 2026-11-14 10:00 WIB (UTC+7) === 2026-11-14T03:00:00Z
const startsAt = new Date("2026-11-14T03:00:00Z");
const endsAt = new Date("2026-11-14T03:30:00Z");

assert.equal(formatUtc(startsAt), "20261114T030000Z", "WIB 10:00 must serialise as 03:00Z");
assert.equal(formatUtc(endsAt), "20261114T033000Z");

const ics = buildIcs({
  uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  startsAt,
  endsAt,
  summary: "Sesi Foto — Matsuri Demo",
  location: "Kampus ITB, Bandung",
  description: "Nama: Deny\nHarga: Rp 75.000",
  now: new Date("2026-10-19T00:00:00Z"),
});

// CRLF only, no bare LF.
assert.ok(ics.includes("\r\n"), "must use CRLF");
assert.ok(!/[^\r]\n/.test(ics), "no bare LF line endings");

// Required VEVENT properties.
for (const line of [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Rin Studio//Commission Booking//EN",
  "BEGIN:VEVENT",
  "UID:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "DTSTAMP:20261019T000000Z",
  "DTSTART:20261114T030000Z",
  "DTEND:20261114T033000Z",
  "END:VEVENT",
  "END:VCALENDAR",
]) {
  assert.ok(ics.split("\r\n").includes(line), `missing line: ${line}`);
}

// Escaping: newline in description becomes literal \n.
assert.ok(ics.includes("DESCRIPTION:Nama: Deny\\nHarga: Rp 75.000"), "text not escaped");

// Every physical line ≤ 75 octets (RFC 5545 §3.1).
for (const line of ics.split("\r\n")) {
  assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long (${Buffer.byteLength(line)}): ${line}`);
}

// Google Calendar link: dates must be UTC, no dashes/colons.
const url = new URL(
  googleCalendarUrl({ uid: "x", startsAt, endsAt, summary: "Sesi Foto — Matsuri Demo" }),
);
assert.equal(url.searchParams.get("dates"), "20261114T030000Z/20261114T033000Z");
assert.equal(url.searchParams.get("action"), "TEMPLATE");

console.log(ics.replace(/\r\n/g, "\n"));
console.log("---");
console.log("google:", url.toString());
console.log("OK: all ics assertions passed");
