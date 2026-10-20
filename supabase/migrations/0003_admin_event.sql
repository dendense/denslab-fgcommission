-- 0003_admin_event.sql — RPC baca event untuk halaman admin (termasuk slot `closed`)
--
-- Isi: satu fungsi `admin_event(p_slug text)` yang dipakai
--      GET /api/admin/events/[slug].
--
-- Kenapa ada: `public_event` (0001) memfilter `status in ('open','booked')`.
-- Itu benar untuk halaman publik — slot yang sengaja ditutup tidak boleh
-- terlihat klien. Tapi akibatnya halaman admin yang reload kehilangan baris slot
-- `closed`, sehingga tombol "Buka slot" tidak bisa dijangkau lagi. Fungsi ini
-- mengembalikan SELURUH slot supaya admin bisa melihat dan membuka kembali.
--
-- Asumsi:
--   * `0001_init.sql` sudah dijalankan (tabel + `public_event` ada).
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--   * Service role key hanya dipakai server-side di API route, tidak pernah ke browser.
--
-- ATURAN:
--   * Bentuk JSON identik dengan `public_event` — superset: nama field sama,
--     `slots[].id` adalah id slot yang sama, dan `slots[].status` kini bisa
--     bernilai 'closed' juga. UI bisa memakai satu tipe untuk keduanya.
--   * `public_event` TIDAK diubah oleh migrasi ini.
--   * Cakupan event: sama dengan `public_event` (`events.status = 'published'`).
--     Event draft belum bisa dibuka admin lewat fungsi ini; tambahkan saat ada
--     kebutuhan mengelola draft.
--   * Grant: nol untuk anon/authenticated. Hanya service_role — payload ini
--     membocorkan struktur internal (slot yang sengaja ditutup).
--
-- Idempotent: aman dijalankan ulang (create or replace + revoke/grant eksplisit).

create or replace function public.admin_event(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
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
  from public.events e
  join public.photographers p on p.id = e.photographer_id
  where p.slug = p_slug
    and e.status = 'published'
  order by e.created_at desc
  limit 1;
$$;

revoke all on function public.admin_event(text) from public;
revoke all on function public.admin_event(text) from anon, authenticated;
grant execute on function public.admin_event(text) to service_role;
