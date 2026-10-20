-- 0010_admin_users_view.sql — admin membaca statistik semua fotografer + buat event atas nama fotografer
--
-- Isi:
--   1. Policy `select` untuk `authenticated` yang lolos kalau `is_admin()` — di lima tabel
--      (photographers, events, event_days, slots, bookings). HANYA baca; nol policy tulis.
--   2. RPC `admin_photographer_stats(p_search)` — satu baris per fotografer + agregat.
--   3. RPC `admin_create_event_for_photographer(p_photographer_id, p_title, p_location)` —
--      admin membuat event `draft` atas nama fotografer lain.
--
-- Asumsi:
--   * `0001_init.sql` … `0009_anon_read_hardening.sql` sudah dijalankan.
--   * `public.is_admin()` (0005) ada dan `grant execute` hanya ke `authenticated`.
--   * `public.current_photographer_id()` (0004) ada — TIDAK dipakai di sini, admin tidak
--     harus punya baris photographers (FIX-3: admin tanpa studio tetap boleh masuk /admin).
--   * Email TIDAK ada di `public.photographers`; satu-satunya sumber adalah `auth.users.email`.
--     `photographers.user_id` nullable (fotografer lama belum punya akun).
--   * `events` tidak punya kolom slug/description; `events.status` hanya draft|published|closed.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- Idempotent: aman dijalankan ulang (drop policy if exists / create or replace /
-- revoke-grant eksplisit).
--
-- Yang TIDAK disentuh: policy `anon` dari 0001 maupun 0009 (grant level tabel tetap
-- sebagaimana 0009), dan seluruh RPC lama — `public_event`, `book_slot`, `booking_by_token`,
-- `set_slot_status`, `create_slot`, `update_slot`, `delete_slot`, `create_event`,
-- `publish_event`. Nol perubahan grant tabel: `authenticated` sudah punya `select` di kelima
-- tabel sejak 0004, jadi policy di bawah langsung berlaku tanpa grant baru.
--
-- ⚠️ TENTANG `revenue_idr` — BUKAN PEMBAYARAN TERKONFIRMASI
-- Angka itu = `sum(slots.price_idr)` untuk slot ber-`status = 'booked'`, yaitu NILAI SLOT
-- YANG TERISI. Proyek ini tidak punya tabel `payments`, tidak punya bukti transfer, tidak
-- punya status lunas — jadi angka ini TIDAK berarti "uang yang sudah masuk". UI wajib
-- memberi label jujur, mis. "Nilai booking terisi — belum tentu sudah dibayar".
-- Jangan menaikkan labelnya jadi "pendapatan" / "revenue terkonfirmasi" tanpa tabel pembayaran.

-- ---------------------------------------------------------------- 1. policy admin read-all
--
-- Satu policy per tabel, semuanya `for select to authenticated using (public.is_admin())`.
-- `is_admin()` sudah `security definer` + `stable`, jadi aman dipanggil dari policy tanpa
-- rekursi ke `admin_users`.
--
-- Kenapa policy terpisah, bukan `or public.is_admin()` di policy `*_owner_select` yang ada:
-- policy 0004 sudah applied dan sudah diverifikasi; menambah policy baru membuat perubahan
-- ini aditif — kalau 0010 di-rollback, jalur fotografer kembali persis seperti semula.
-- Postgres OR-ing policy permissive, jadi admin mendapat gabungan keduanya.

drop policy if exists photographers_admin_select on public.photographers;
create policy photographers_admin_select on public.photographers
  for select to authenticated
  using (public.is_admin());

drop policy if exists events_admin_select on public.events;
create policy events_admin_select on public.events
  for select to authenticated
  using (public.is_admin());

drop policy if exists event_days_admin_select on public.event_days;
create policy event_days_admin_select on public.event_days
  for select to authenticated
  using (public.is_admin());

drop policy if exists slots_admin_select on public.slots;
create policy slots_admin_select on public.slots
  for select to authenticated
  using (public.is_admin());

-- bookings menyimpan nama + nomor WhatsApp klien. Policy ini hanya `select`, hanya
-- `authenticated`, dan hanya lolos untuk admin — anon tetap nol akses (0001: RLS aktif
-- tanpa policy anon = nol baris; grant `select` anon juga tidak ada).
drop policy if exists bookings_admin_select on public.bookings;
create policy bookings_admin_select on public.bookings
  for select to authenticated
  using (public.is_admin());

-- NOL policy insert/update/delete untuk admin di sini. Admin hanya membaca statistik;
-- satu-satunya jalur tulis admin adalah RPC di bagian 3, yang menulis `events` sebagai
-- definer dan memaksa `status = 'draft'`.

-- ---------------------------------------------------------------- 2. admin_photographer_stats
--
-- Satu baris per fotografer, termasuk yang belum punya akun dan yang belum punya event
-- (LEFT JOIN, bukan INNER) — halaman /users harus bisa menampilkan "0 event" sebagai
-- keadaan, bukan menghilangkan barisnya.
--
-- `events_done`: event dianggap selesai kalau SEMUA `event_days`-nya sudah lewat, yaitu
-- `max(day_date) < current_date` di zona Asia/Jakarta. Bukan dari `events.status`: status
-- hanya draft|published|closed, dan `closed` berarti "ditarik", bukan "sudah berlangsung".
-- Event tanpa `event_days` → `max(day_date)` null → TIDAK masuk hitungan (bukan dianggap
-- selesai, bukan pula dianggap belum selesai).
--
-- `revenue_idr`: lihat peringatan di header file. `sum()` tanpa baris = NULL, jadi
-- fotografer tanpa slot booked mendapat NULL (bukan 0) — itu sebabnya urutan memakai
-- `nulls last`. UI yang memutuskan menampilkannya sebagai "—" atau "0".
--
-- `p_search`: substring case-insensitive pada nama ATAU email. NULL / kosong / whitespace
-- saja = semua baris. Catatan: `%` dan `_` di dalam p_search tetap berlaku sebagai wildcard
-- LIKE — input ini hanya untuk admin, dan hasilnya tidak bisa membocorkan baris yang tidak
-- boleh dilihat admin (admin memang melihat semua).
--
-- Agregat dihitung lewat LATERAL, bukan join datar: join events × event_days × slots ×
-- bookings akan mengalikan hitungan (satu event dengan 8 slot jadi 8 baris event).

create or replace function public.admin_photographer_stats(p_search text default null)
returns table (
  photographer_id  uuid,
  slug             text,
  display_name     text,
  contact_wa       text,
  email            text,
  has_account      boolean,
  events_total     int,
  events_published int,
  events_done      int,
  slots_total      int,
  bookings_total   int,
  revenue_idr      bigint,
  last_event_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  return query
  select
    q.photographer_id,
    q.slug,
    q.display_name,
    q.contact_wa,
    q.email,
    q.has_account,
    q.events_total,
    q.events_published,
    q.events_done,
    q.slots_total,
    q.bookings_total,
    q.revenue_idr,
    q.last_event_at
  from (
    select
      p.id                                                as photographer_id,
      p.slug                                              as slug,
      p.display_name                                      as display_name,
      p.contact_wa                                        as contact_wa,
      u.email                                             as email,
      (p.user_id is not null)                             as has_account,
      coalesce(ev.events_total, 0)::int                   as events_total,
      coalesce(ev.events_published, 0)::int               as events_published,
      coalesce(ev.events_done, 0)::int                    as events_done,
      coalesce(sl.slots_total, 0)::int                    as slots_total,
      coalesce(bk.bookings_total, 0)::int                 as bookings_total,
      sl.revenue_idr                                      as revenue_idr,
      ev.last_event_at                                    as last_event_at
    from public.photographers p
    left join auth.users u on u.id = p.user_id
    left join lateral (
      select
        count(*)                                                              as events_total,
        count(*) filter (where e.status = 'published')                        as events_published,
        count(*) filter (
          where last_day.max_day is not null
            and last_day.max_day < (now() at time zone 'Asia/Jakarta')::date
        )                                                                     as events_done,
        max(e.created_at)                                                     as last_event_at
      from public.events e
      left join lateral (
        select max(d.day_date) as max_day
        from public.event_days d
        where d.event_id = e.id
      ) last_day on true
      where e.photographer_id = p.id
    ) ev on true
    left join lateral (
      select
        count(*)                                                     as slots_total,
        sum(s.price_idr) filter (where s.status = 'booked')          as revenue_idr
      from public.slots s
      join public.event_days d on d.id = s.event_day_id
      join public.events e     on e.id = d.event_id
      where e.photographer_id = p.id
    ) sl on true
    left join lateral (
      select count(*) as bookings_total
      from public.bookings b
      join public.slots s      on s.id = b.slot_id
      join public.event_days d on d.id = s.event_day_id
      join public.events e     on e.id = d.event_id
      where e.photographer_id = p.id
    ) bk on true
    where p_search is null
       or btrim(p_search) = ''
       or p.display_name ilike '%' || p_search || '%'
       or u.email        ilike '%' || p_search || '%'
  ) q
  order by q.revenue_idr desc nulls last, q.display_name asc;
end;
$$;

revoke all on function public.admin_photographer_stats(text) from public;
revoke all on function public.admin_photographer_stats(text) from anon;
grant execute on function public.admin_photographer_stats(text) to authenticated;

-- ---------------------------------------------------------------- 3. admin_create_event_for_photographer
--
-- Jalur admin untuk membuat event atas nama fotografer lain. `create_event` (0007) TIDAK
-- diubah: di sana `photographer_id` diambil dari sesi sehingga admin yang memanggilnya akan
-- membuat event atas namanya sendiri (atau `not_photographer` kalau admin tidak punya studio).
--
-- `status` selalu `draft` dan bukan parameter: penerbitan tetap lewat `publish_event` milik
-- fotografer (atau alur admin yang sudah ada). `photographer_id` hanya dari parameter dan
-- TIDAK bisa jatuh ke `current_photographer_id()` — pemanggilnya admin, bukan pemilik.
--
-- Urutan cek: admin → fotografer ada → judul valid. `photographer_not_found` untuk id yang
-- tidak ada (id acak maupun fotografer yang sudah dihapus — dari sisi admin keduanya sama).

create or replace function public.admin_create_event_for_photographer(
  p_photographer_id uuid,
  p_title           text,
  p_location        text default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.events;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.photographers where id = p_photographer_id) then
    raise exception 'photographer_not_found' using errcode = 'P0001';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;

  insert into public.events (photographer_id, title, location, status)
  values (
    p_photographer_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_location, '')), ''),
    'draft'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.admin_create_event_for_photographer(uuid, text, text) from public;
revoke all on function public.admin_create_event_for_photographer(uuid, text, text) from anon;
grant execute on function public.admin_create_event_for_photographer(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 4. catatan apply
--
-- Dijalankan Deny lewat Supabase SQL Editor / dashboard (bukan `supabase db push`).
-- Aman dijalankan dua kali. Verifikasi cepat setelah apply:
--
--   select policyname from pg_policies
--    where schemaname = 'public' and policyname like '%_admin_select' order by 1;
--   -- harapan: 5 baris
--
--   select proname from pg_proc
--    where proname in ('admin_photographer_stats',
--                      'admin_create_event_for_photographer') order by 1;
--   -- harapan: 2 baris
