-- 0015_admin_event_read.sql — admin boleh membaca event studio mana pun (jalur baca)
--
-- Penutup rangkaian 0012/0014. Keduanya memberi `is_admin()` ke 11 RPC TULIS; `admin_event`
-- satu-satunya RPC BACA yang masih murni owner-scoped, jadi admin dapat `not_owner` saat
-- membuka event studio lain. Perluasan, bukan fungsi baru, dengan alasan yang sama seperti
-- 0012: satu fungsi = satu tempat otorisasi. Hanya satu baris otorisasi yang berubah:
--
--     if not (public.is_admin() or <pemilik slug>) then raise 'not_owner'
--
-- Cakupan tetap SATU event (yang `published` terbaru untuk slug itu), TIDAK diubah jadi
-- daftar semua event studio. Alasannya bukan selera: bentuk balikan fungsi ini dikonsumsi
-- apa adanya oleh `app/api/admin/events/by-slug/[slug]/route.ts` sebagai
-- `Omit<PublicEvent, "timezone">` — `{ event, photographer, days }` satu event. Mengubahnya
-- jadi array akan memecah route itu dan tipe kliennya tanpa memberi UI apa pun, karena
-- editor admin (`app/admin/events/[id]/page.tsx`) tidak memanggil `admin_event` sama sekali;
-- ia membaca lewat `getEvent()` di `lib/admin-events.ts` (select PostgREST by id, sudah
-- dilayani policy `events_admin_select` dari 0010). Daftar event per studio = RPC lain,
-- di luar kartu ini.
--
-- Kenapa `is not distinct from`, bukan `=`: sama seperti 0012/0014. `photographer_id` memang
-- `not null`, jadi kedua operator berperilaku identik di sini — dipakai konsisten supaya
-- alasan otorisasi seluruh rangkaian seragam. `authenticated` yang belum di-approve
-- (studio null) tetap `not_owner` untuk slug apa pun, termasuk slug yang tidak ada.
--
-- Perilaku yang SENGAJA tidak berubah:
--   * Slug tidak ada → `not_owner` untuk non-admin (persis 0004: "tidak ada" dan "bukan
--     punyamu" sama-sama bukan urusanmu), dan `null` untuk admin (guard lolos, select tidak
--     menemukan baris). `null` itulah yang diterjemahkan route jadi 404 `not_found`; kalau
--     di sini admin diberi `event_not_found` seperti jalur tulis 0012, route akan jatuh ke
--     cabang generik dan mengembalikan 500 — regresi.
--   * Filter `e.status = 'published'` dipertahankan: event draft studio lain tetap tidak
--     terbaca lewat fungsi ini. Editor berbasis id sudah bisa membuka draft lewat
--     `getEvent()`; menambah draft di sini akan mengubah arti "event mana yang sedang
--     ditampilkan" tanpa ada pemanggil yang meminta.
--   * Bentuk JSON, urutan kunci, filter slot (`tanpa` filter status: admin lihat `closed`),
--     dan grant tidak berubah.
--
-- Asumsi:
--   * `0001_init.sql` … `0014_admin_slot_ops.sql` sudah dijalankan.
--   * `public.is_admin()` (0005) ada, `security definer` + `stable`, grant `authenticated`.
--   * `public.current_photographer_id()` (0004) mengembalikan studio pemanggil (bukan null)
--     untuk admin yang punya baris `photographers` — jangan andalkan "admin tanpa studio".
--   * Body diambil dari versi terakhir yang berlaku, yaitu 0004 (plpgsql + `v_out`), bukan
--     versi `language sql` dari 0003.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- TIDAK disentuh: `public_event` (jalur publik — tetap hanya event `published` milik satu
-- fotografer), `book_slot`, `booking_by_token`, `create_event`, `create_slot`/`update_slot`/
-- `delete_slot`/`set_slot_status`/`unpublish_event`, keenam RPC 0012, `admin_photographer_stats`,
-- `admin_create_event_for_photographer`, dan SELURUH policy/RLS/grant tabel.
--
-- Idempotent: aman dijalankan ulang (create or replace + revoke/grant eksplisit).

create or replace function public.admin_event(p_slug text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not (public.is_admin()
          or exists (
            select 1
              from public.events e
              join public.photographers p on p.id = e.photographer_id
             where p.slug = p_slug
               and e.photographer_id is not distinct from public.current_photographer_id()
          )) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'event', jsonb_build_object(
      'id',          e.id,
      'slug',        p.slug,
      'title',       e.title,
      'location',    e.location,
      'status',      e.status
    ),
    'photographer', jsonb_build_object(
      'display_name', p.display_name,
      'contact_wa',   p.contact_wa
    ),
    'days', coalesce(
      (
        select jsonb_agg(day_obj order by day_date)
        from (
          select
            d.day_date,
            jsonb_build_object(
              'id',         d.id,
              'day_date',   d.day_date,
              'start_time', d.start_time,
              'end_time',   d.end_time,
              'slots', coalesce(
                (
                  select jsonb_agg(
                           jsonb_build_object(
                             'id',        s.id,
                             'seq',       s.seq,
                             'starts_at', s.starts_at,
                             'ends_at',   s.ends_at,
                             'price_idr', s.price_idr,
                             'status',    s.status
                           )
                           order by s.seq
                         )
                  from public.slots s
                  where s.event_day_id = d.id  -- sengaja TANPA filter status: admin lihat semua
                ),
                '[]'::jsonb
              )
            ) as day_obj
          from public.event_days d
          where d.event_id = e.id
        ) days_q
      ),
      '[]'::jsonb
    )
  )
  into v_out
  from public.events e
  join public.photographers p on p.id = e.photographer_id
  where p.slug = p_slug
    and e.status = 'published'
  order by e.created_at desc
  limit 1;

  return v_out;
end;
$$;

revoke all on function public.admin_event(text) from public;
revoke all on function public.admin_event(text) from anon;
grant execute on function public.admin_event(text) to authenticated;
grant execute on function public.admin_event(text) to service_role;
