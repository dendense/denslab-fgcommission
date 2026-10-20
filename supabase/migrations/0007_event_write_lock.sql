-- 0007_event_write_lock.sql — tabel `events` + `event_days` jadi read-only; semua tulis lewat RPC
--
-- Isi:
--   1. Cabut grant insert/update/delete pada `public.events` dan `public.event_days` dari
--      `authenticated` dan `anon`. `select` dipertahankan (halaman publik + admin membacanya).
--   2. Hapus policy tulis `*_owner_insert|update|delete` dari 0004 untuk kedua tabel; policy
--      `select` dibiarkan. Tanpa grant, policy tulis tidak pernah dievaluasi.
--   3. RPC pengganti jalur tulis:
--        create_event, update_event, publish_event, unpublish_event, delete_event,
--        create_event_day, update_event_day, delete_event_day
--      Semua `security definer`, `set search_path = public`, grant `authenticated` saja.
--
-- Asumsi:
--   * `0001_init.sql` … `0006_slot_write_lock.sql` sudah dijalankan.
--     `current_photographer_id()` (0004) dipakai untuk cek kepemilikan.
--   * Kolom yang dipakai adalah kolom yang BENAR-BENAR ada:
--       events      (id, photographer_id, title, location, status, created_at)
--       event_days  (id, event_id, day_date, start_time, end_time)
--     `events` TIDAK punya kolom `slug` — slug ada di `photographers`, dan `public_event` /
--     `admin_event` mencari event lewat `photographers.slug`. Karena itu tidak ada parameter
--     slug di RPC di bawah, dan tidak ada kolom baru yang ditambahkan di sini.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- Idempotent: aman dijalankan ulang (create or replace / drop policy if exists /
-- revoke-grant eksplisit).
--
-- Latar belakang: aturan event hanya ditegakkan di aplikasi. Lewat PostgREST, pemilik event
-- masih bisa menulis langsung, melewati semua aturan:
--   PATCH /rest/v1/events     {status:'closed'}        → 200  (halaman publik + QR mati)
--   PATCH /rest/v1/event_days {day_date:'2026-11-20'}  → 200  (slot pindah hari)
-- Karena itu kedua tabel ditutup untuk tulis; satu-satunya pintu adalah RPC di bawah
-- (plus `create_slot`/`update_slot`/`delete_slot`/`set_slot_status` dari 0006 untuk slot).

-- ---------------------------------------------------------------- 1. cabut tulis langsung
--
-- `select` sengaja TIDAK dicabut: /e/[slug] dan /admin membaca kedua tabel, dan policy
-- `events_anon_select` / `events_owner_select` (0001/0004) tetap berlaku.

revoke insert, update, delete on table public.events     from authenticated;
revoke insert, update, delete on table public.events     from anon;
revoke insert, update, delete on table public.event_days from authenticated;
revoke insert, update, delete on table public.event_days from anon;

-- ---------------------------------------------------------------- 2. policy tulis mati
--
-- Policy di bawah ini (dari 0004) hanya bisa menyala kalau ada grant tulis. Grant-nya baru
-- saja dicabut, jadi mereka mati — dan kalau suatu saat grant dikembalikan tanpa sengaja,
-- policy inilah yang akan langsung membuka jalur tulis. Dibuang sekarang.

drop policy if exists events_owner_insert on public.events;
drop policy if exists events_owner_update on public.events;
drop policy if exists events_owner_delete on public.events;

drop policy if exists event_days_owner_insert on public.event_days;
drop policy if exists event_days_owner_update on public.event_days;
drop policy if exists event_days_owner_delete on public.event_days;

-- ---------------------------------------------------------------- 3a. create_event
--
-- `photographer_id` diambil dari sesi, tidak pernah dari parameter: pemanggil tidak bisa
-- membuat event atas nama orang lain. `status` selalu `draft` dan tidak bisa diminta lain —
-- event terbit tanpa hari & slot = halaman publik kosong yang membingungkan klien, jadi
-- penerbitan punya RPC sendiri (`publish_event`).
--
-- Tidak ada parameter `p_photographer_id` dan tidak ada `p_status` sama sekali, jadi
-- "mengubah field immutable" bukan sesuatu yang bisa dicoba lalu diabaikan — PostgREST
-- menolak panggilan dengan parameter tak dikenal (PGRST202, function not found).

create or replace function public.create_event(
  p_title    text,
  p_location text default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_row   public.events;
begin
  v_owner := public.current_photographer_id();

  -- Login tapi belum di-approve admin: tidak ada baris photographers untuk user ini.
  if v_owner is null then
    raise exception 'not_photographer' using errcode = 'P0001';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;

  insert into public.events (photographer_id, title, location, status)
  values (
    v_owner,
    btrim(p_title),
    nullif(btrim(coalesce(p_location, '')), ''),
    'draft'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_event(text, text) from public;
revoke all on function public.create_event(text, text) from anon;
grant execute on function public.create_event(text, text) to authenticated;

-- ---------------------------------------------------------------- 3b. update_event
--
-- Hanya `title` dan `location`. `photographer_id` (kepemilikan) dan `status` (terbit/tarik)
-- sengaja bukan parameter: memindahkan event ke akun lain = event hilang dari pemiliknya,
-- dan status punya RPC sendiri supaya "terbitkan" tidak terjadi karena salah kirim body.
--
-- Argumen null = "jangan ubah" (`coalesce`), jadi satu RPC bisa dipakai untuk ubah judul
-- saja, lokasi saja, atau keduanya. Konsekuensinya `location` tidak bisa dikosongkan lewat
-- RPC ini — sama seperti `update_slot` di 0006.
--
-- Urutan cek: ada → milik sendiri.

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

  if v_row.photographer_id is distinct from public.current_photographer_id() then
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

-- ---------------------------------------------------------------- 3c. publish_event / unpublish_event
--
-- Terpisah dari `update_event` dengan sengaja: menerbitkan dan menarik event mengubah link
-- QR yang mungkin sudah disebar ke klien. Itu keputusan tersendiri, bukan efek samping
-- menyimpan form.
--
-- `publish_event` menolak event tanpa satu pun `event_days` (`no_days`): event terbit tanpa
-- hari = halaman publik kosong. Idempotent — publish event yang sudah published hanya
-- mengembalikan barisnya.

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

  if v_row.photographer_id is distinct from public.current_photographer_id() then
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

create or replace function public.unpublish_event(p_event_id uuid)
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

  if v_row.photographer_id is distinct from public.current_photographer_id() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  -- Kembali ke `draft`, bukan `closed`: `closed` adalah status penutupan permanen yang
  -- tidak punya RPC pembuka, sedangkan tarik-terbit harus bisa diulang.
  update public.events
     set status = 'draft'
   where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.unpublish_event(uuid) from public;
revoke all on function public.unpublish_event(uuid) from anon;
grant execute on function public.unpublish_event(uuid) to authenticated;

-- ---------------------------------------------------------------- 3d. delete_event
--
-- Ditolak kalau event punya booking apa pun (`event_has_bookings`): rantai
-- events → event_days → slots → bookings semuanya `on delete cascade`, jadi satu DELETE
-- akan menghapus booking klien tanpa jejak.
--
-- Urutan cek: ada → milik sendiri → booking.

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

  if v_owner is distinct from public.current_photographer_id() then
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

-- ---------------------------------------------------------------- 3e. create_event_day
--
-- `not_owner` juga dipakai untuk event yang tidak ada: dari sisi pemanggil, "tidak ada" dan
-- "bukan punyamu" sama-sama bukan urusannya (pola yang sama dengan 0006).
--
-- Tanggal duplikat dalam satu event ditolak `duplicate_day`. 0001 TIDAK punya unique
-- constraint pada (event_id, day_date), jadi pemeriksaan ini dilakukan di sini — dua
-- panggilan bersamaan masih bisa lolos dua-duanya. Kalau itu perlu ditutup di DB, tambahkan
-- `unique (event_id, day_date)` di migrasi terpisah (butuh backfill kalau sudah ada duplikat).

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

  if v_owner is distinct from public.current_photographer_id() then
    raise exception 'not_owner' using errcode = 'P0001';
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
end;
$$;

revoke all on function public.create_event_day(uuid, date, time, time) from public;
revoke all on function public.create_event_day(uuid, date, time, time) from anon;
grant execute on function public.create_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 3f. update_event_day
--
-- Hanya tanggal dan jam. `event_id` bukan parameter: memindahkan hari ke event lain akan
-- memindahkan slot dan booking klien ke halaman publik yang berbeda. Pindah event = hari baru.
--
-- Argumen null = "jangan ubah". Urutan cek: hari ada → milik sendiri → tanggal duplikat.

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

  if v_owner is distinct from public.current_photographer_id() then
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
end;
$$;

revoke all on function public.update_event_day(uuid, date, time, time) from public;
revoke all on function public.update_event_day(uuid, date, time, time) from anon;
grant execute on function public.update_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 3g. delete_event_day
--
-- Ditolak kalau ada slot ber-`booked` di hari itu (`day_has_bookings`): slots dan bookings
-- ikut terhapus lewat cascade, jadi booking klien hilang tanpa jejak.
-- Slot `open`/`closed` boleh ikut terhapus — tidak ada janji apa pun ke klien di sana.
--
-- Urutan cek: hari ada → milik sendiri → booked.

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

  if v_owner is distinct from public.current_photographer_id() then
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

-- ---------------------------------------------------------------- 4. yang TIDAK diubah
--
-- * `public_event` (0001), `book_slot` (0001), `booking_by_token` (0001): jalur publik/klien,
--   tidak disentuh.
-- * `set_slot_status` (0002 + 0004), `admin_event` (0003 + 0004), `create_slot` /
--   `update_slot` / `delete_slot` (0006): tidak disentuh.
-- * `current_photographer_id()` (0004) dan `approve_access_request()` (0005): tidak disentuh.
-- * Policy `select` (`events_anon_select`, `events_owner_select`, `event_days_anon_select`,
--   `event_days_owner_select`): tetap ada.
--
-- Catatan grant: RPC di atas hanya diberikan ke `authenticated`, TIDAK ke `service_role`
-- (beda dengan 0006 yang memberi keduanya). Alasannya: jalur admin berjalan dengan sesi user,
-- dan `service_role` tidak punya `auth.uid()` sehingga `current_photographer_id()` selalu
-- null di sana — grant execute untuk service_role hanya akan menghasilkan `not_photographer`
-- yang membingungkan, bukan jalur yang berguna.
