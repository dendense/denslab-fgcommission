-- 0009_anon_read_hardening.sql — cabut dua jalur baca `anon` yang tidak dipakai halaman publik
--
-- Isi:
--   1. `public.events` — grant select level TABEL untuk `anon` dicabut, diganti
--      column-level grant 5 kolom publik: (id, title, location, status, created_at).
--      `photographer_id` tidak lagi bisa dibaca `anon`, bahkan lewat `select=*`.
--   2. `public.slots` — select `anon` dicabut seluruhnya, dan policy
--      `slots_anon_select` (0001) dibuang. Halaman publik membaca slot lewat RPC
--      `public_event` (0001), yang memproyeksikan kolomnya sendiri dan sudah
--      memfilter `status in ('open','booked')`.
--
-- Asumsi:
--   * `0001_init.sql` … `0008_event_day_unique.sql` sudah dijalankan.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--   * Tidak ada kode aplikasi yang membaca `slots` langsung dengan kredensial anon.
--     Diperiksa 2026-10-20: `app/e/[slug]/page.tsx`, `app/e/[slug]/book/[slotId]/page.tsx`,
--     `app/api/events/[slug]/route.ts`, dan `proxy.ts` semuanya lewat RPC `public_event`.
--     Admin membaca `events`/`event_days`/`slots` sebagai `authenticated`
--     (`lib/admin-events.ts`), dan grant `authenticated` TIDAK disentuh migrasi ini.
--   * `events` tidak punya kolom slug; slug ada di `photographers`.
--
-- Idempotent: aman dijalankan ulang (revoke/grant eksplisit + `drop policy if exists`).
--
-- ---------------------------------------------------------------- latar belakang
--
-- Dua kebocoran read-only lewat PostgREST mentah dengan anon key (yang ada di bundle
-- browser, jadi siapa pun memegangnya):
--
--   GET /rest/v1/events?select=*                 → 200, termasuk `photographer_id`
--   GET /rest/v1/slots?status=eq.closed&select=* → 200, slot yang sengaja ditutup
--
-- Sebabnya BUKAN policy: `events_anon_select` dan `slots_anon_select` (0001) hanya
-- row-level, sementara grant-nya level tabel penuh — policy tidak bisa membatasi kolom,
-- dan `slots_anon_select` sama sekali tidak menyaring `slots.status`.
--
-- Koreksi untuk komentar `0003_admin_event.sql:6-8` (file itu TIDAK diubah — sudah
-- applied di sebagian lingkungan): klaim "slot yang sengaja ditutup tidak boleh terlihat
-- klien" hanya benar lewat RPC `public_event`, TIDAK lewat PostgREST mentah. Migrasi ini
-- yang menutup selisihnya.
--
-- Kenapa `slots` dicabut total, bukan sekadar ditambah `status in ('open','booked')` ke
-- policy: filter di policy tetap menyisakan jalur baca mentah untuk slot `open`
-- (`price_idr`, `starts_at`, `seq`), yang harus terus disamakan dengan bentuk
-- `public_event` setiap kali salah satunya berubah. Satu pintu baca lebih mudah dijaga.
--
-- `events` tetap boleh dibaca anon karena policy row-level-nya masih berguna (event
-- `draft`/`closed` tidak boleh terlihat), tetapi hanya 5 kolom publik yang di-grant.
-- Policy `event_days_anon_select` / `slots_anon_select` membaca `events.id` dan
-- `events.status` di dalam subquery-nya — keduanya termasuk dalam grant di bawah,
-- jadi policy tetap bisa dievaluasi sebagai `anon`.

-- ---------------------------------------------------------------- 1. events: kolom publik saja
--
-- `photographers` (0001) sudah memakai pola ini: column-level grant, sehingga
-- `select=*` gagal dengan 42501 dan hanya kolom yang di-grant yang bisa dibaca.

revoke select on table public.events from anon;
grant select (id, title, location, status, created_at) on table public.events to anon;

-- ---------------------------------------------------------------- 2. slots: nol akses anon
--
-- Policy dibuang bersamaan dengan grant-nya, sama seperti pola 0006: tanpa grant policy
-- tidak pernah dievaluasi, dan menyisakannya hanya mengundang orang memberi grant lagi
-- tanpa sadar membuka kembali jalur baca mentah.

revoke select on table public.slots from anon;
drop policy if exists slots_anon_select on public.slots;
