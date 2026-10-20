-- seed-demo.sql — data demo: 1 fotografer, 1 event, 1 hari, 8 slot @30 menit, Rp75.000.
--
-- Asumsi: sudah menjalankan 0001_init.sql. JANGAN dijalankan oleh agent —
-- Deny yang mengeksekusi di Supabase SQL editor.
--
-- Idempotent: UUID tetap + on conflict do nothing, aman dijalankan ulang.
-- Tanggal demo: Sabtu 14 November 2026, 10:00–14:00 WIB (Asia/Jakarta).

insert into public.photographers (id, slug, display_name, contact_wa)
values (
  '11111111-1111-4111-8111-111111111111',
  'demo',
  'Rin Studio',
  '6281234567890'
)
on conflict (id) do nothing;

insert into public.events (id, photographer_id, title, location, status)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Matsuri Demo',
  'Kampus ITB, Bandung',
  'published'
)
on conflict (id) do nothing;

insert into public.event_days (id, event_id, day_date, start_time, end_time)
values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  '2026-11-14',
  '10:00',
  '14:00'
)
on conflict (id) do nothing;

-- 8 slot x 30 menit: 10:00–10:30 ... 13:30–14:00 WIB.
-- starts_at/ends_at disimpan sebagai timestamptz; literal waktu lokal dikonversi
-- eksplisit dengan `at time zone 'Asia/Jakarta'` supaya tidak bergantung timezone server.
-- Idempotent lewat unique(event_day_id, seq), bukan lewat id yang dirangkai dari string.
insert into public.slots (event_day_id, seq, starts_at, ends_at, price_idr, status)
select
  '33333333-3333-4333-8333-333333333333',
  n,
  (timestamp '2026-11-14 10:00' + (n - 1) * interval '30 minutes') at time zone 'Asia/Jakarta',
  (timestamp '2026-11-14 10:30' + (n - 1) * interval '30 minutes') at time zone 'Asia/Jakarta',
  75000,
  'open'
from generate_series(1, 8) as n
on conflict (event_day_id, seq) do nothing;
