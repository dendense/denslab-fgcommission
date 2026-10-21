-- 0019_reject_delete_archive.sql — tolak = hapus data, start_registration, arsip + hapus fotografer
--
-- Keputusan Deny: penolakan pendaftaran BUKAN lagi status `rejected` — barisnya dihapus.
-- Plus admin bisa mengarsipkan (`archived_at`) dan menghapus fotografer.
--
-- Isi:
--   1. `public.reject_access_request(uuid, text)` — SIGNATURE BERUBAH di sisi hasil:
--      `returns public.access_requests` → `returns void` (barisnya dihapus, tidak ada
--      yang bisa dikembalikan). Parameter `p_note` DIPERTAHANKAN supaya pemanggil lama
--      tidak patah, tapi tidak lagi disimpan — lihat catatan di fungsinya.
--   2. `public.start_registration()` — RPC baru, WAJIB. Tanpa ini penghapusan baris
--      membuat user tidak bisa mendaftar lagi sama sekali: `handle_new_user` (0005)
--      hanya menyala pada INSERT ke `auth.users`, dan akun Google-nya tidak dihapus.
--   3. `public.photographers.archived_at timestamptz` — penanda arsip.
--   4. `public.archive_photographer(uuid)`, `public.unarchive_photographer(uuid)`,
--      `public.delete_photographer(uuid)` — tiga RPC admin.
--   5. `public.public_event(text)` — sembunyikan event milik fotografer terarsip
--      (mengembalikan null, sama seperti slug tidak ada → `/e/[slug]` 404 lewat proxy).
--      Signature dan bentuk `jsonb` TIDAK berubah.
--   6. `public.admin_photographer_stats(text)` — SIGNATURE BERUBAH: tambah `archived_at`
--      di akhir daftar kolom. `instagram` (0018) dan `u.email::text` (0011) DIPERTAHANKAN.
--   7. `resubmit_access_request()` dan `admin_restore_access_request(uuid)` dibuang —
--      keduanya hanya punya arti selama `rejected` ditulis, dan sekarang tidak pernah.
--
-- Asumsi:
--   * `0001_init.sql` … `0018_photographer_instagram.sql` sudah dijalankan. 0018 wajib:
--     `admin_photographer_stats` di bawah adalah salinan 0018 (yang membawa `instagram`)
--     + satu kolom, bukan salinan 0010.
--   * `public.is_admin()` (0005) ada, `security definer` + `stable`, grant `authenticated`.
--   * `auth.users`, `auth.uid()` ada (Supabase default). `access_requests.user_id` unik
--     (`0005`) — `on conflict (user_id)` di `start_registration` bergantung padanya.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--   * Tidak ada kode aplikasi yang memanggil `resubmit_access_request` /
--     `admin_restore_access_request` SETELAH kartu UI 0019 mendarat. Sampai saat itu
--     `app/_components/ResubmitButton.tsx` dan `app/api/admin/access-requests/route.ts`
--     (action `restore`) masih menunjuk ke keduanya dan akan gagal PGRST202.
--
-- Idempotent: `add column if not exists`, `drop function if exists` sebelum setiap fungsi
-- yang signature/return type-nya berubah, `create or replace` untuk sisanya, revoke/grant
-- eksplisit. Dua kali berturut-turut → `md5(pg_get_functiondef)` sama.
--
-- Yang TIDAK disentuh: policy/RLS apa pun, column grant anon pada `photographers`
-- (`slug, display_name, contact_wa` dari 0001/0009 — `archived_at` TIDAK ditambahkan),
-- `my_registration_status`, `complete_registration`, `approve_access_request`,
-- `handle_new_user`, `book_slot`, `booking_by_token`, dan seluruh RPC
-- 0006/0007/0012/0014/0015.
--
-- Dijalankan Deny lewat Supabase SQL Editor (bukan `supabase db push`).
-- Verifikasi setelah apply:
--
--   select proname, pg_get_function_result(oid) from pg_proc
--    where proname in ('admin_photographer_stats', 'reject_access_request');
--   -- harapan: stats memuat `instagram` DAN `archived_at`; reject returns `void`
--
--   select count(*) from pg_proc
--    where proname in ('resubmit_access_request', 'admin_restore_access_request');
--   -- harapan: 0
--
--   select column_name, data_type from information_schema.columns
--    where table_name = 'photographers' and column_name = 'archived_at';
--   -- harapan: 1 baris, `timestamp with time zone`

-- ---------------------------------------------------------------- 1. reject = hapus

-- Return type berubah (`public.access_requests` → `void`), dan Postgres menolak
-- `create or replace` yang mengganti tipe balikan — jadi drop dulu, lalu create ulang +
-- grant ulang (grant ikut hilang bersama fungsinya).
--
-- Kenapa `void` dan bukan baris yang sudah dihapus: setelah DELETE, baris itu tidak ada
-- lagi. Mengembalikan salinannya akan membuat route admin menampilkan "permintaan
-- ditolak" seolah masih ada di antrian, padahal `select` berikutnya mengembalikan nol
-- baris. `app/api/admin/access-requests/route.ts` mengirim `result: data`, dan `null`
-- adalah jawaban yang jujur.
--
-- `p_note` DIPERTAHANKAN (default null) supaya route lama yang mengirim `p_note` tidak
-- gagal PGRST202 — PostgREST mencocokkan nama argumen, bukan jumlah. Nilainya SENGAJA
-- diabaikan: tidak ada baris yang bisa menyimpannya. Tidak ada `raise notice` supaya
-- setiap penolakan tidak menulis baris log yang tidak dibaca siapa pun.
drop function if exists public.reject_access_request(uuid, text);

create function public.reject_access_request(
  p_request_id uuid,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.access_requests;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  -- `for update`: balapan dengan admin lain (atau dengan user yang menekan
  -- `start_registration` di detik yang sama) berakhir pada satu urutan yang jelas.
  select * into v_req from public.access_requests where id = p_request_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Hanya yang masih menunggu. `approved` berarti studio sudah dibuat — menghapusnya
  -- akan meninggalkan fotografer tanpa jejak pendaftaran. `rejected` (baris warisan
  -- pra-0019) juga ditolak di sini: menghapusnya bukan keputusan baru, dan user sudah
  -- punya jalur sendiri lewat `start_registration`.
  if v_req.status <> 'pending' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  delete from public.access_requests where id = p_request_id;
end;
$$;

revoke all on function public.reject_access_request(uuid, text) from public;
revoke all on function public.reject_access_request(uuid, text) from anon;
grant execute on function public.reject_access_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. start_registration

-- KENAPA RPC INI WAJIB ADA (bukan sekadar pelengkap):
--
-- `handle_new_user` (0005) adalah trigger `after insert on auth.users`. Menghapus baris
-- `access_requests` TIDAK menghapus akun Google user — dan aplikasi memang tidak punya
-- izin ke `auth.users` (dan Deny memilih akunnya tetap hidup). Jadi setelah ditolak:
--
--   login lagi → tidak ada INSERT ke `auth.users` → trigger tidak menyala
--              → tidak ada baris `access_requests`
--              → `/register` tidak punya apa pun untuk ditampilkan, antrian admin kosong,
--                dan user TIDAK PUNYA JALAN untuk mendaftar lagi.
--
-- 0017 memperbaiki bentuk yang lebih ringan dari bug ini (`rejected` → `pending` lewat
-- resubmit). 0019 menghapus barisnya, jadi jalur itu hilang; fungsi inilah penggantinya:
-- satu-satunya cara user membuat baris pendaftaran untuk dirinya sendiri.
--
-- Empat keadaan:
--   * tidak ada baris        → INSERT `pending` (jalur normal untuk user baru & user
--                              yang barisnya baru dihapus admin)
--   * `pending`              → `already_pending` (memanggil dua kali tidak boleh
--                              menghasilkan dua permintaan; `requested_at` tidak digeser
--                              diam-diam, jadi posisi antrian tidak berubah)
--   * `approved`             → `already_approved` (aksesnya sudah ada; baris ini bukan
--                              formulir pendaftaran lagi)
--   * `rejected` (warisan)   → DELETE lalu INSERT `pending`. Baris warisan masih ada di
--                              DB hosted sampai admin membersihkannya; memperlakukannya
--                              sebagai "sudah diputuskan" akan membuat user itu tetap
--                              terkunci, persis bug 0017.
--
-- `email` diambil dari `auth.users`, BUKAN dari klaim JWT: `access_requests.email` adalah
-- `not null`, dan trigger 0005 juga memakai `new.email`. Sumber yang sama = bentuk baris
-- yang sama, sehingga `approve_access_request` (yang menurunkan slug dari email) tetap
-- menghasilkan slug yang wajar.
--
-- `display_name`: `raw_user_meta_data->>'full_name'` (Google OAuth) → `'name'` (provider
-- lain) → local-part email. Semua di-`nullif(btrim(...))` supaya string kosong tidak
-- menang atas fallback berikutnya.
create or replace function public.start_registration()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_req   public.access_requests;
  v_email text;
  v_name  text;
begin
  -- anon tidak punya grant execute; ini jaring pengaman untuk pemanggil tanpa klaim
  -- `sub` (mis. service_role) — sama seperti guard di `complete_registration` (0013).
  if v_uid is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  -- `for update`: balapan dua tab (atau user vs admin yang menghapus barisnya) berakhir
  -- pada satu urutan yang jelas, bukan pada dua INSERT yang salah satunya kena
  -- `unique_violation` mentah.
  select * into v_req from public.access_requests where user_id = v_uid for update;

  if found then
    if v_req.status = 'pending' then
      raise exception 'already_pending' using errcode = 'P0001';
    elsif v_req.status = 'approved' then
      raise exception 'already_approved' using errcode = 'P0001';
    end if;

    -- Sisa `rejected` warisan. `studio_name`/`contact_wa`/`instagram` ikut hilang:
    -- ini pengajuan baru, dan data yang dulu jadi alasan penolakan tidak boleh menempel.
    delete from public.access_requests where id = v_req.id;
  end if;

  select u.email::text,
         coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(btrim(split_part(u.email::text, '@', 1)), '')
         )
    into v_email, v_name
    from auth.users u
   where u.id = v_uid;

  -- JWT sah tapi baris `auth.users` hilang = keadaan yang tidak mungkin lewat aplikasi.
  -- Berhenti di sini lebih baik daripada INSERT dengan email kosong.
  if not found then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  insert into public.access_requests (user_id, email, display_name)
  values (v_uid, coalesce(v_email, ''), v_name)
  on conflict (user_id) do nothing;
end;
$$;

-- `authenticated` saja. `anon` tanpa JWT selalu `unauthorized`, `service_role` tidak
-- punya `auth.uid()` — memberi grant hanya menyamarkan klien yang salah.
revoke all on function public.start_registration() from public;
revoke all on function public.start_registration() from anon;
grant execute on function public.start_registration() to authenticated;

-- ---------------------------------------------------------------- 3. kolom arsip

-- Nullable tanpa default: baris lama (fotografer yang sudah ada) tidak punya nilainya,
-- jadi NOT NULL akan menggagalkan migrasi. `null` = aktif, terisi = diarsip.
--
-- Arsip BUKAN hapus: baris, event, dan booking tetap utuh; yang berubah hanya
-- keterlihatannya di halaman publik (`public_event`) dan penandaan di `/users`.
alter table public.photographers add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------- 4. tiga RPC admin
--
-- Semuanya `security definer` dengan guard `is_admin()` sendiri. Grant execute bukan
-- izin — ia hanya pintu; `is_admin()` yang memutuskan (pola 0005/0013/0017).

-- Arsipkan. Idempoten-TIDAK: memanggil dua kali adalah kesalahan pemanggil (tombol
-- ganda, dua tab), bukan keadaan yang boleh ditelan diam-diam — `already_archived`
-- memberi route kesempatan menjawab 409 alih-alih 200 palsu.
create or replace function public.archive_photographer(p_photographer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select archived_at into v_archived
    from public.photographers where id = p_photographer_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_archived is not null then
    raise exception 'already_archived' using errcode = 'P0001';
  end if;

  update public.photographers
     set archived_at = now()
   where id = p_photographer_id;
end;
$$;

revoke all on function public.archive_photographer(uuid) from public;
revoke all on function public.archive_photographer(uuid) from anon;
grant execute on function public.archive_photographer(uuid) to authenticated;

-- Batalkan arsip. Simetris dengan di atas: `not_archived` kalau memang sedang aktif.
create or replace function public.unarchive_photographer(p_photographer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select archived_at into v_archived
    from public.photographers where id = p_photographer_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_archived is null then
    raise exception 'not_archived' using errcode = 'P0001';
  end if;

  update public.photographers
     set archived_at = null
   where id = p_photographer_id;
end;
$$;

revoke all on function public.unarchive_photographer(uuid) from public;
revoke all on function public.unarchive_photographer(uuid) from anon;
grant execute on function public.unarchive_photographer(uuid) to authenticated;

-- Hapus fotografer yang belum pernah punya event.
--
-- Guard event di sini BUKAN kenyamanan: `events.photographer_id` adalah
-- `on delete cascade` (0001), jadi satu DELETE tanpa guard akan ikut menghapus seluruh
-- event, day, slot, dan booking studio itu — data klien yang tidak bisa dikembalikan.
-- Menghapus studio yang sudah pernah jalan harus lewat keputusan eksplisit (arsip),
-- bukan lewat tombol yang sama dengan "bersihkan pendaftar salah ketik".
--
-- `access_requests` milik user yang sama ikut dihapus supaya dia bisa mendaftar ulang
-- (`start_registration` membuat baris `pending` baru). Kalau tidak dihapus, baris
-- `approved` lama akan membuat `start_registration` menjawab `already_approved` untuk
-- akun yang fotografernya sudah tidak ada.
--
-- `auth.users` TIDAK disentuh — aplikasi tidak punya izin ke sana, dan Deny memilih akun
-- Google-nya tetap hidup. Akibatnya user itu masih bisa login dan mendaftar lagi, yang
-- memang tujuannya.
--
-- `user_id` null (fotografer lama pra-0004, tanpa akun): cukup hapus barisnya, tidak ada
-- `access_requests` untuk dicari.
create or replace function public.delete_photographer(p_photographer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select user_id into v_user_id
    from public.photographers where id = p_photographer_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Apa pun statusnya (`draft`, `published`, `closed`): event yang pernah ada berarti
  -- studio itu punya riwayat, dan riwayat tidak dihapus lewat RPC ini.
  if exists (select 1 from public.events where photographer_id = p_photographer_id) then
    raise exception 'photographer_has_events' using errcode = 'P0001';
  end if;

  delete from public.photographers where id = p_photographer_id;

  if v_user_id is not null then
    delete from public.access_requests where user_id = v_user_id;
  end if;
end;
$$;

revoke all on function public.delete_photographer(uuid) from public;
revoke all on function public.delete_photographer(uuid) from anon;
grant execute on function public.delete_photographer(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. public_event: sembunyikan yang diarsip
--
-- Satu baris berubah dibanding 0018: `and p.archived_at is null`.
--
-- Fotografer terarsip → nol baris → fungsi mengembalikan `null` (SQL function tanpa
-- baris = NULL), persis seperti slug yang tidak ada. `/e/[slug]` sudah memperlakukan
-- null sebagai 404 di `proxy.ts`/`lib/public-event.ts`, jadi tidak ada perubahan klien.
-- Memilih null dan bukan `{event:null}`: bentuk balikan tetap `jsonb {event, photographer,
-- days}` untuk semua nilai yang BUKAN null, jadi `PublicEvent` di `lib/types.ts` utuh.
--
-- Filter diletakkan di JOIN, bukan di WHERE, karena `p` sudah di-INNER JOIN — hasilnya
-- sama, tapi menaruhnya di JOIN membuat syaratnya terbaca sebagai bagian dari "fotografer
-- mana yang boleh tampil", sejajar dengan `e.status = 'published'`.
--
-- Signature dan `returns jsonb` tidak berubah → `create or replace` cukup.
create or replace function public.public_event(p_slug text)
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
      'contact_wa',   p.contact_wa,
      'instagram',    p.instagram
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
                  where s.event_day_id = d.id
                    and s.status in ('open', 'booked')  -- 'closed' tidak ditampilkan
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
  join public.photographers p
    on p.id = e.photographer_id
   and p.archived_at is null          -- 0019: fotografer terarsip tidak tampil di publik
  where p.slug = p_slug
    and e.status = 'published'
  order by e.created_at desc
  limit 1;
$$;

-- Grant tidak berubah dari 0001/0018 — ditulis ulang supaya berkas ini tetap benar sendiri.
revoke all on function public.public_event(text) from public;
grant execute on function public.public_event(text) to anon, service_role;

-- ---------------------------------------------------------------- 6. admin_photographer_stats (+archived_at)
--
-- Signature BERUBAH (`archived_at` ditambahkan di AKHIR daftar `returns table`), jadi
-- drop + create + grant ulang. Di akhir, bukan di tengah: pemanggil yang memakai nama
-- kolom tidak terpengaruh, dan yang memakai posisi tidak ada di repo ini.
--
-- Body = salinan 0018 (yang membawa `instagram` dan `u.email::text`) + satu kolom.
-- JANGAN kembali ke 0010: tanpa `instagram` UI `/users` kehilangan kolom IG, tanpa
-- `::text` di email fungsi ini gagal 42804 di hosted (`varchar(255)`, pelajaran 0011).
--
-- `p.archived_at` dikembalikan APA ADANYA (bukan boolean): UI perlu membedakan "aktif"
-- dari "diarsip kapan", dan kolom boolean akan memaksa round-trip kedua untuk tanggalnya.
-- Baris terarsip TETAP muncul di sini — `/users` adalah halaman admin, satu-satunya tempat
-- tombol "batal arsip" bisa hidup.
drop function if exists public.admin_photographer_stats(text);

create function public.admin_photographer_stats(p_search text default null)
returns table (
  photographer_id  uuid,
  slug             text,
  display_name     text,
  contact_wa       text,
  instagram        text,
  email            text,
  has_account      boolean,
  events_total     int,
  events_published int,
  events_done      int,
  slots_total      int,
  bookings_total   int,
  revenue_idr      bigint,
  last_event_at    timestamptz,
  archived_at      timestamptz
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
    q.instagram,
    q.email,
    q.has_account,
    q.events_total,
    q.events_published,
    q.events_done,
    q.slots_total,
    q.bookings_total,
    q.revenue_idr,
    q.last_event_at,
    q.archived_at
  from (
    select
      p.id                                                as photographer_id,
      p.slug                                              as slug,
      p.display_name                                      as display_name,
      p.contact_wa                                        as contact_wa,
      p.instagram::text                                   as instagram,
      u.email::text                                       as email,
      (p.user_id is not null)                             as has_account,
      coalesce(ev.events_total, 0)::int                   as events_total,
      coalesce(ev.events_published, 0)::int               as events_published,
      coalesce(ev.events_done, 0)::int                    as events_done,
      coalesce(sl.slots_total, 0)::int                    as slots_total,
      coalesce(bk.bookings_total, 0)::int                 as bookings_total,
      sl.revenue_idr                                      as revenue_idr,
      ev.last_event_at                                    as last_event_at,
      p.archived_at                                       as archived_at
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

-- Sama seperti 0010/0018: `authenticated` saja (0018 tidak memberi `service_role`, jadi
-- tidak ada grant yang perlu dipertahankan di sini). `is_admin()` di dalam fungsi yang
-- memutuskan, bukan grant-nya.
revoke all on function public.admin_photographer_stats(text) from public;
revoke all on function public.admin_photographer_stats(text) from anon;
grant execute on function public.admin_photographer_stats(text) to authenticated;

-- ---------------------------------------------------------------- 7. buang yang jadi mati
--
-- `resubmit_access_request()` (0017) mengubah baris `rejected` → `pending`.
-- `admin_restore_access_request(uuid)` (0017) melakukan hal yang sama dari sisi admin.
-- Sejak 0019 tidak ada satu pun jalur yang menulis `rejected`, jadi keduanya tidak punya
-- masukan yang sah: dipanggil, keduanya hanya akan `no_registration` / `invalid_state`.
-- Menyisakannya berarti menyimpan dua pintu yang selalu menolak, plus dua grant execute
-- yang harus ikut diaudit setiap kali aturan status berubah.
--
-- Yang menempel dan ikut hilang bersama fungsinya: `grant execute ... to authenticated`
-- (0017). Tidak ada policy, trigger, view, atau default yang mereferensikan keduanya —
-- diperiksa dengan `grep -rn` atas `supabase/migrations` dan `pg_depend` di harness lokal.
-- Satu-satunya referensi yang tersisa ada di KODE APLIKASI dan itu wilayah kartu UI:
--   * `app/_components/ResubmitButton.tsx` → `rpc("resubmit_access_request")`
--   * `app/api/admin/access-requests/route.ts` → action `restore` → `admin_restore_access_request`
-- Setelah kartu UI mendarat, keduanya harus pindah ke `start_registration()` dan
-- `reject_access_request()`.
--
-- Status `rejected` TETAP ada di `check` constraint `access_requests` (0005): baris
-- warisan di hosted masih bisa berstatus itu sampai dibersihkan, dan `start_registration`
-- menanganinya. Tidak ada gunanya menyempitkan constraint untuk keadaan yang akan hilang
-- sendiri.
drop function if exists public.resubmit_access_request();
drop function if exists public.admin_restore_access_request(uuid);
