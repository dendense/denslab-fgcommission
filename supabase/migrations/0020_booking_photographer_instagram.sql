-- 0020_booking_photographer_instagram.sql — instagram fotografer di balikan `booking_by_token`
--
-- Masalah: halaman `/booking/[icsToken]` ("Booking tercatat") punya tombol "Hubungi fotografer"
-- yang masih mengarah ke WhatsApp. Deny memintanya pindah ke akun Instagram fotografer.
-- Kolomnya sudah ada (`public.photographers.instagram`, 0018, nullable, disimpan TANPA `@`),
-- tapi halaman itu membaca lewat RPC `booking_by_token`, dan RPC itu belum membawa instagram.
--
-- Isi:
--   1. `public.booking_by_token(uuid)` — tambah kunci `instagram` di dalam objek `photographer`.
--      Signature, tipe balikan (`jsonb`), `security definer`, `stable`, `search_path`, dan
--      seluruh kunci lain TIDAK berubah. Field baru bersifat aditif.
--
-- Asumsi:
--   * `0001_init.sql` … `0019_reject_delete_archive.sql` sudah dijalankan. 0018 wajib:
--     `photographers.instagram` dibuat di sana.
--   * `booking_by_token` masih versi 0001 — tidak ada migrasi 0002–0019 yang mendefinisikannya
--     ulang (0015/0018/0019 hanya menyebutnya di daftar "TIDAK disentuh"). Body di bawah adalah
--     salinan 0001 + satu baris proyeksi.
--   * Tidak ada kolom expiry/cancel di `public.bookings` — RPC ini memang tidak punya logika
--     kadaluarsa, dan migrasi ini tidak menambahkannya.
--
-- Kenapa `create or replace` cukup: tipe balikan tetap `jsonb`, jadi tidak ada `drop function`
-- dan ACL tidak hilang. Grant di bawah ditulis ulang eksplisit supaya berkas ini benar sendiri
-- dan idempoten; hasilnya identik dengan 0001 (`service_role` saja).
--
-- Nilai `instagram` diproyeksikan APA ADANYA dari DB (tanpa `@`) dan `null` kalau kosong.
-- Tidak ada penambahan `@` di sini: prefix itu urusan UI (`instagram.com/<user>`), dan
-- normalisasi `@`/spasi sudah dilakukan sekali di `complete_registration` (0018).
--
-- 🔴 `select` anon ke `public.photographers` TIDAK dibuka, dan column grant anon TIDAK
-- diperluas (tetap `slug, display_name, contact_wa`). Instagram keluar HANYA lewat proyeksi
-- RPC ini, untuk klien yang memegang `ics_token`. Ini alasan yang sama dengan 0009/0018.
--
-- Idempotent: `create or replace` + revoke/grant eksplisit. Dua kali berturut-turut →
-- `md5(pg_get_functiondef)` sama.
--
-- Yang TIDAK disentuh: policy/RLS apa pun, column grant anon (`photographers`), `public_event`,
-- `book_slot`, `admin_photographer_stats`, `archived_at` (0019), dan seluruh RPC 0018/0019.
-- Filter `archived_at` juga sengaja TIDAK ditambahkan di sini: booking yang sudah ada tetap
-- harus bisa dibuka pemiliknya walaupun fotografernya diarsipkan sesudahnya — menyembunyikan
-- halaman booking yang sudah dibayar bukan perbaikan.
--
-- Dijalankan Deny lewat Supabase SQL Editor (bukan `supabase db push`).
-- Verifikasi setelah apply:
--
--   select pg_get_function_result('public.booking_by_token(uuid)'::regprocedure);
--   -- harapan: jsonb
--
--   select public.booking_by_token('<ics_token>'::uuid)->'photographer';
--   -- harapan: {"instagram": ..., "contact_wa": ..., "display_name": ...}
--
--   select has_function_privilege('anon', 'public.booking_by_token(uuid)', 'execute'),
--          has_function_privilege('service_role', 'public.booking_by_token(uuid)', 'execute');
--   -- harapan: f | t   (anon TIDAK boleh, sama seperti 0001)

create or replace function public.booking_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'ics_token',   b.ics_token,
    'client_name', b.client_name,
    'notes',       b.notes,
    'created_at',  b.created_at,
    'slot', jsonb_build_object(
      'id',        s.id,
      'starts_at', s.starts_at,
      'ends_at',   s.ends_at,
      'price_idr', s.price_idr
    ),
    'event', jsonb_build_object(
      'title',    e.title,
      'location', e.location,
      'slug',     p.slug
    ),
    'photographer', jsonb_build_object(
      'display_name', p.display_name,
      'contact_wa',   p.contact_wa,
      'instagram',    p.instagram
    )
  )
  from public.bookings b
  join public.slots s         on s.id = b.slot_id
  join public.event_days d    on d.id = s.event_day_id
  join public.events e        on e.id = d.event_id
  join public.photographers p on p.id = e.photographer_id
  where b.ics_token = p_token;
$$;

-- Grant sama persis dengan 0001: token adalah satu-satunya kredensial klien, dan RPC ini
-- mengembalikan nama + nomor WhatsApp klien. `anon` tanpa grant execute = token tidak bisa
-- ditebak lewat PostgREST. Server memanggilnya sebagai `service_role` (`lib/bookings.ts`).
revoke all on function public.booking_by_token(uuid) from public;
revoke all on function public.booking_by_token(uuid) from anon, authenticated;
grant execute on function public.booking_by_token(uuid) to service_role;
