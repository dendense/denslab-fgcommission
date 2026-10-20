-- 0012_admin_event_ops.sql — admin boleh mengelola event studio mana pun (jalur tulis)
--
-- Kenapa memperluas RPC yang sudah ada, bukan membuat `admin_*_event_day` baru:
-- 0007/0008 mengotorisasi lewat `current_photographer_id()` dibandingkan dengan
-- `events.photographer_id`. Fungsi itu mengembalikan studio MILIK PEMANGGIL, jadi admin
-- yang punya baris `photographers` sendiri (Deny: slug `demo`) selalu ditolak `not_owner`
-- saat menyentuh event studio lain — dan admin tanpa studio juga ditolak, karena
-- `current_photographer_id()` = null. 0010 sudah membuka jalur BACA lewat policy
-- `*_admin_select`; yang kurang hanya jalur tulis. Kalau jalur admin dibuat sebagai fungsi
-- terpisah, seluruh body (validasi `duplicate_day`, `no_days`, `day_has_bookings`,
-- `event_has_bookings`, urutan cek) harus disalin dua kali dan UI harus bercabang antara dua
-- RPC. Satu fungsi dengan dua peran sah = satu tempat otorisasi, satu tempat bug. Karena
-- itu di sini hanya satu baris otorisasi per fungsi yang berubah:
--
--     if not (public.is_admin() or <pemilik event>) then raise 'not_owner'
--
-- Cabang lama dipertahankan apa adanya: fotografer biasa berperilaku persis seperti
-- sebelum 0012. Untuk event yang tidak ada, `not_owner` tetap pesan yang keluar di jalur
-- fotografer (dari sisi pemanggil, "tidak ada" dan "bukan punyamu" sama-sama bukan
-- urusannya); hanya jalur admin yang mendapat `event_not_found`, karena admin memang
-- berhak tahu bedanya.
--
-- Kenapa `is not distinct from`, bukan `=`: dengan `=`, perbandingan yang menyentuh null
-- menghasilkan null, `not (false or null)` juga null, dan blok `if` dilewati. Akibatnya
-- `authenticated` yang belum di-approve (studio null) yang mengirim id event tidak ada akan
-- lolos otorisasi lalu gagal di FK `23503` — persis perilaku 0008 yang harus dipertahankan.
-- `is not distinct from` selalu true/false, jadi jalur non-admin menghasilkan pesan yang
-- sama seperti 0008 untuk setiap kombinasi.
--
-- Isi:
--   1. `create_event_day`   — admin boleh menambah hari ke event siapa pun
--   2. `update_event_day`   — admin boleh mengubah hari siapa pun
--   3. `delete_event_day`   — admin boleh menghapus hari siapa pun (`day_has_bookings` tetap)
--   4. `update_event`       — admin boleh ubah judul/lokasi event siapa pun
--   5. `publish_event`      — admin boleh menerbitkan (`no_days` tetap)
--   6. `delete_event`       — admin boleh hapus (`event_has_bookings` tetap)
--
-- Asumsi:
--   * `0001_init.sql` … `0011_fix_stats_revenue_type.sql` sudah dijalankan.
--   * `public.is_admin()` (0005) ada, `security definer` + `stable`, grant `authenticated`.
--   * `public.current_photographer_id()` (0004) ada dan mengembalikan studio pemanggil
--     (bukan null) untuk admin yang punya baris `photographers` — jangan andalkan
--     "admin tidak punya studio" untuk mendeteksi peran.
--   * Body `create_event_day` / `update_event_day` diambil dari 0008 (versi terakhir yang
--     berlaku, termasuk penangkap `unique_violation`), bukan dari 0007.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- TIDAK disentuh: `create_event` (jalur admin sudah ada di 0010 lewat
-- `admin_create_event_for_photographer`), `unpublish_event`, `book_slot`, `public_event`,
-- `admin_event`, `set_slot_status`, `create_slot`/`update_slot`/`delete_slot`,
-- `admin_photographer_stats`, dan SELURUH policy/RLS/grant tabel. Signature keenam fungsi
-- di bawah tidak berubah (nama parameter, tipe, urutan, tipe balikan) — UI memanggil dengan
-- nama parameter.
--
-- Idempotent: aman dijalankan ulang (semua `create or replace` + revoke/grant eksplisit).

-- ---------------------------------------------------------------- 1. create_event_day
--
-- Sama seperti 0008, plus cabang admin. Tambahan satu guard yang HANYA berlaku untuk admin:
-- admin yang mengirim id acak akan gagal di `insert` dengan `23503` mentah (FK violation)
-- tanpa pesan yang bisa dibaca. Guard ini tidak menyentuh jalur non-admin — pemanggil yang
-- bukan admin dan bukan pemilik tetap mendapat `not_owner` persis seperti sebelumnya
-- (termasuk `authenticated` yang belum di-approve, yang di 0008 lolos cek otorisasi karena
-- `null is not distinct from null` lalu gagal di FK; perilaku itu DIPERTAHANKAN).

create or replace function public.create_event_day(
  p_event_id   uuid,
  p_day_date   date,
  p_start_time time,
  p_end_time   time
)
returns public.event_days
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_row   public.event_days;
begin
  select photographer_id into v_owner from public.events where id = p_event_id;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  -- Hanya admin yang bisa sampai di sini dengan v_owner null (lihat komentar di atas).
  if public.is_admin() and v_owner is null then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.event_days
     where event_id = p_event_id and day_date = p_day_date
  ) then
    raise exception 'duplicate_day' using errcode = 'P0001';
  end if;

  insert into public.event_days (event_id, day_date, start_time, end_time)
  values (p_event_id, p_day_date, p_start_time, p_end_time)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    -- Balapan: transaksi lain menyisipkan (event_id, day_date) yang sama lebih dulu.
    raise exception 'duplicate_day' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_event_day(uuid, date, time, time) from public;
revoke all on function public.create_event_day(uuid, date, time, time) from anon;
grant execute on function public.create_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 2. update_event_day
--
-- Sama seperti 0008, plus cabang admin. `event_id` tetap bukan parameter: memindahkan hari
-- ke event lain akan memindahkan slot dan booking klien ke halaman publik yang berbeda.

create or replace function public.update_event_day(
  p_event_day_id uuid,
  p_day_date     date default null,
  p_start_time   time default null,
  p_end_time     time default null
)
returns public.event_days
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.event_days;
  v_owner uuid;
begin
  select e.photographer_id
    into v_owner
    from public.event_days d
    join public.events e on e.id = d.event_id
   where d.id = p_event_day_id;

  if not found then
    raise exception 'day_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  if p_day_date is not null and exists (
    select 1 from public.event_days
     where event_id = (select event_id from public.event_days where id = p_event_day_id)
       and day_date = p_day_date
       and id <> p_event_day_id
  ) then
    raise exception 'duplicate_day' using errcode = 'P0001';
  end if;

  update public.event_days
     set day_date   = coalesce(p_day_date, day_date),
         start_time = coalesce(p_start_time, start_time),
         end_time   = coalesce(p_end_time, end_time)
   where id = p_event_day_id
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'duplicate_day' using errcode = 'P0001';
end;
$$;

revoke all on function public.update_event_day(uuid, date, time, time) from public;
revoke all on function public.update_event_day(uuid, date, time, time) from anon;
grant execute on function public.update_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 3. delete_event_day
--
-- `day_has_bookings` dipertahankan untuk kedua peran: slot dan bookings ikut terhapus lewat
-- cascade, jadi satu DELETE akan menghapus booking klien tanpa jejak. Urutan cek tetap
-- hari ada → otorisasi → booked.

create or replace function public.delete_event_day(p_event_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select e.photographer_id
    into v_owner
    from public.event_days d
    join public.events e on e.id = d.event_id
   where d.id = p_event_day_id;

  if not found then
    raise exception 'day_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.slots
     where event_day_id = p_event_day_id and status = 'booked'
  ) then
    raise exception 'day_has_bookings' using errcode = 'P0001';
  end if;

  delete from public.event_days where id = p_event_day_id;
end;
$$;

revoke all on function public.delete_event_day(uuid) from public;
revoke all on function public.delete_event_day(uuid) from anon;
grant execute on function public.delete_event_day(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. update_event
--
-- Hanya `title` dan `location`; `photographer_id` dan `status` tetap bukan parameter, untuk
-- admin sekalipun. Admin yang perlu memindahkan event ke studio lain melakukannya di luar
-- RPC ini — bukan perilaku yang dibuka diam-diam di sini.

create or replace function public.update_event(
  p_event_id uuid,
  p_title    text default null,
  p_location text default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.events;
begin
  select * into v_row from public.events where id = p_event_id;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_row.photographer_id is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  update public.events
     set title    = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         location = coalesce(nullif(btrim(coalesce(p_location, '')), ''), location)
   where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_event(uuid, text, text) from public;
revoke all on function public.update_event(uuid, text, text) from anon;
grant execute on function public.update_event(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 5. publish_event
--
-- `no_days` dipertahankan: event terbit tanpa hari = halaman publik kosong. Idempotent —
-- publish event yang sudah published hanya mengembalikan barisnya. `unpublish_event`
-- TIDAK ikut diperluas (tidak diminta, dan tidak ada jalur admin di UI untuk menarik event
-- studio lain).

create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.events;
begin
  select * into v_row from public.events where id = p_event_id;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_row.photographer_id is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.event_days where event_id = p_event_id) then
    raise exception 'no_days' using errcode = 'P0001';
  end if;

  update public.events
     set status = 'published'
   where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.publish_event(uuid) from public;
revoke all on function public.publish_event(uuid) from anon;
grant execute on function public.publish_event(uuid) to authenticated;

-- ---------------------------------------------------------------- 6. delete_event
--
-- `event_has_bookings` dipertahankan untuk kedua peran: rantai events → event_days → slots →
-- bookings semuanya `on delete cascade`. Urutan cek tetap ada → otorisasi → booking, jadi
-- event yang tidak ada tetap `event_not_found` (bukan `not_owner`) seperti sebelumnya.

create or replace function public.delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select photographer_id into v_owner from public.events where id = p_event_id;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.event_days d
      join public.slots s      on s.event_day_id = d.id
      join public.bookings b   on b.slot_id = s.id
     where d.event_id = p_event_id
  ) then
    raise exception 'event_has_bookings' using errcode = 'P0001';
  end if;

  delete from public.events where id = p_event_id;
end;
$$;

revoke all on function public.delete_event(uuid) from public;
revoke all on function public.delete_event(uuid) from anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- ---------------------------------------------------------------- 7. catatan apply
--
-- Dijalankan Deny lewat Supabase SQL Editor / dashboard (bukan `supabase db push`).
-- Aman dijalankan dua kali. Verifikasi cepat setelah apply:
--
--   select proname, pg_get_function_identity_arguments(oid) as args
--     from pg_proc
--    where proname in ('create_event_day', 'update_event_day', 'delete_event_day',
--                      'update_event', 'publish_event', 'delete_event')
--    order by 1;
--   -- harapan: 6 baris, signature sama seperti sebelum 0012
--
--   select proname from pg_proc
--    where proname in ('create_event_day', 'update_event_day', 'delete_event_day',
--                      'update_event', 'publish_event', 'delete_event')
--      and prosrc like '%is_admin()%'
--    order by 1;
--   -- harapan: 6 baris
