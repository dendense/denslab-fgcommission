-- 0011_fix_stats_revenue_type.sql — `admin_photographer_stats`: dua cast tipe hasil
--
-- Masalah: di Supabase hosted, RPC `public.admin_photographer_stats(text)` gagal
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type character varying(255) does not match expected type text in column 5.
-- Kolom 5 adalah `email`. `auth.users.email` di Supabase hosted bertipe
-- `character varying(255)`, sementara `returns table (... email text ...)` meminta `text`.
-- `plpgsql` TIDAK melakukan cast implisit pada `RETURN QUERY`, jadi kegagalan ini terjadi
-- saat perencanaan query — bahkan kalau tabelnya kosong.
--
-- Perbaikan (dua-duanya di daftar SELECT, bukan di klausa WHERE):
--   1. `u.email::text`          -> varchar(255) memenuhi deklarasi `email text`.
--   2. `sum(price_idr)::bigint` -> `sum()` mengembalikan `bigint` untuk `int4` dan `numeric`
--      untuk `int8`/`numeric`; cast membuat deklarasi `revenue_idr bigint` benar untuk
--      KEDUA keadaan. Perilaku NULL DIPERTAHANKAN — tanpa `coalesce`, jadi fotografer tanpa
--      slot `booked` tetap mendapat `null`, bukan `0`. UI membedakan "belum ada booking"
--      (null) dari "booking bernilai 0".
--
-- Kedua cast diverifikasi di harness lokal (PG + PostgREST) dengan `auth.users.email`
-- sengaja dideklarasikan `character varying(255)`: tanpa cast -> 42804 persis seperti
-- hosted; dengan cast -> 200 dan `revenue_idr` tetap null untuk fotografer tanpa booking.
--
-- Isi: HANYA `create or replace function public.admin_photographer_stats(text)` + grant
-- ulang (sama seperti 0010). Tidak menyentuh `admin_create_event_for_photographer`,
-- policy, tabel, atau migrasi lain.
--
-- Asumsi:
--   * `0001_init.sql` … `0010_admin_users_view.sql` sudah dijalankan.
--   * `public.is_admin()` (0005) ada dan `grant execute` hanya ke `authenticated`.
--   * `photographers.user_id` nullable; email satu-satunya sumber `auth.users.email`.
--
-- Idempotent: `create or replace` + revoke/grant eksplisit → aman dijalankan berkali-kali.
-- Dijalankan Deny lewat Supabase SQL Editor (bukan `supabase db push`).
--
-- Verifikasi setelah apply (harus 1 baris, `prosrc` memuat kedua cast):
--
--   select position('::bigint' in prosrc) > 0 as has_bigint,
--          position('email::text' in prosrc) > 0 as has_email_text
--     from pg_proc where proname = 'admin_photographer_stats';
--
--   select proname, pg_get_function_result(oid)
--     from pg_proc where proname = 'admin_photographer_stats';
--
-- Diagnostik tipe sumber (jalankan SEBELUM/SESUDAH apply, di SQL Editor yang sama):
--
--   select table_schema, table_name, column_name, data_type, character_maximum_length
--     from information_schema.columns
--    where (table_schema = 'auth'  and table_name = 'users' and column_name = 'email')
--       or (table_schema = 'public' and table_name = 'slots' and column_name = 'price_idr');
--
--   auth.users.email 'character varying' -> tanpa `::text`  -> 42804 kolom 5
--   slots.price_idr  'bigint'|'numeric'  -> sum() = numeric -> tanpa `::bigint` 42804 kolom 12
--
-- `::bigint` pada sumber `numeric` membulatkan ke bilangan bulat terdekat. Aman di sini
-- karena `price_idr` adalah rupiah utuh (tidak pernah pecahan).

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
      u.email::text                                       as email,
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
        (sum(s.price_idr) filter (where s.status = 'booked'))::bigint as revenue_idr
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
