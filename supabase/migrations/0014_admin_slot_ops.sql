-- 0014_admin_slot_ops.sql — admin boleh mengelola slot + menarik event studio mana pun
--
-- Lanjutan langsung dari `0012_admin_event_ops.sql`: 0012 membuka jalur tulis hari dan event
-- untuk admin, tapi slot dan `unpublish_event` masih memakai cek pemilik murni — jadi event
-- studio lain bisa punya hari tanpa satu slot pun, artinya belum bisa dipesan. Sama seperti
-- 0012, fungsi yang sudah ada DIPERLUAS (bukan `admin_*` baru), supaya body lama
-- (`slot_booked`, `invalid_status`, `slot_not_found`, urutan cek) tidak tersalin dua kali:
--
--     if not (public.is_admin() or <pemilik slot/event>) then raise 'not_owner'
--
-- `is not distinct from` dipakai dengan alasan yang sama seperti 0012: dengan `=`,
-- perbandingan yang menyentuh null menghasilkan null, blok `if` dilewati, dan `authenticated`
-- yang belum di-approve (studio null) yang mengirim id acak akan gagal di FK `23503` alih-alih
-- `not_owner` — perilaku 0006/0007 yang harus dipertahankan. Guard tambahan hanya untuk admin
-- (`create_slot` dengan hari yang tidak ada → `day_not_found`) mengikuti pola
-- `create_event_day` di 0012: admin berhak tahu bedanya, non-admin tetap `not_owner`.
--
-- Isi:
--   1. `create_slot`      — admin boleh menambah slot ke hari siapa pun
--   2. `update_slot`      — admin boleh ubah harga/jam slot siapa pun (`slot_booked` tetap)
--   3. `delete_slot`      — admin boleh hapus slot siapa pun (`slot_booked` tetap, baris utuh)
--   4. `set_slot_status`  — admin boleh buka/tutup slot siapa pun (`slot_booked` tetap)
--   5. `unpublish_event`  — admin boleh menarik event siapa pun ke `draft`
--
-- Asumsi:
--   * `0001_init.sql` … `0013_oauth_onboarding.sql` sudah dijalankan.
--   * `public.is_admin()` (0005) ada, `security definer` + `stable`, grant `authenticated`.
--   * `public.current_photographer_id()` (0004) mengembalikan studio pemanggil (bukan null)
--     untuk admin yang punya baris `photographers` — jangan andalkan "admin tanpa studio".
--   * Body diambil dari versi terakhir yang berlaku: `create_slot`/`update_slot`/`delete_slot`
--     dari 0006, `set_slot_status` dari 0004, `unpublish_event` dari 0007.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- TIDAK disentuh: `book_slot`, `public_event`, `booking_by_token`, `admin_event`,
-- `create_event`, `admin_create_event_for_photographer`, `admin_photographer_stats`,
-- `create_event_day`/`update_event_day`/`delete_event_day`/`update_event`/`publish_event`/
-- `delete_event` (sudah diperluas 0012), dan SELURUH policy/RLS/grant tabel. Signature kelima
-- fungsi di bawah tidak berubah (nama parameter, tipe, urutan, tipe balikan) — UI memanggil
-- dengan nama parameter.
--
-- Idempotent: aman dijalankan ulang (semua `create or replace` + revoke/grant eksplisit).

-- ---------------------------------------------------------------- 1. create_slot
--
-- Sama seperti 0006, plus cabang admin. Slot baru tetap selalu `status = 'open'` — slot
-- `booked` hanya lahir dari `book_slot`, untuk admin sekalipun. Urutan cek tetap kepemilikan
-- dulu, baru `duplicate_seq` (lewat unique_violation), supaya hari milik orang lain tidak bisa
-- dipakai menebak seq mana yang sudah terpakai.

create or replace function public.create_slot(
  p_event_day_id uuid,
  p_seq          int,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_price_idr    int
)
returns public.slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.slots;
  v_owner uuid;
begin
  select e.photographer_id
    into v_owner
    from public.event_days d
    join public.events e on e.id = d.event_id
   where d.id = p_event_day_id;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  -- Hanya admin yang bisa sampai di sini dengan v_owner null (hari tidak ada); non-admin
  -- dengan studio null tetap lolos cek di atas lalu gagal di FK, persis seperti 0006.
  if public.is_admin() and v_owner is null then
    raise exception 'day_not_found' using errcode = 'P0001';
  end if;

  insert into public.slots (event_day_id, seq, starts_at, ends_at, price_idr, status)
  values (p_event_day_id, p_seq, p_starts_at, p_ends_at, p_price_idr, 'open')
  returning * into v_row;

  return v_row;
exception
  -- unique(event_day_id, seq) dari 0001. Diterjemahkan ke nama error yang stabil
  -- supaya route tidak perlu mencocokkan teks constraint Postgres.
  when unique_violation then
    raise exception 'duplicate_seq' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_slot(uuid, int, timestamptz, timestamptz, int) from public;
revoke all on function public.create_slot(uuid, int, timestamptz, timestamptz, int) from anon;
grant execute on function public.create_slot(uuid, int, timestamptz, timestamptz, int) to authenticated;
grant execute on function public.create_slot(uuid, int, timestamptz, timestamptz, int) to service_role;

-- ---------------------------------------------------------------- 2. update_slot
--
-- Sama seperti 0006, plus cabang admin. Hanya harga dan jam; `seq`, `event_day_id`, dan
-- `status` tetap bukan parameter. Slot `booked` tetap ditolak untuk kedua peran — klien sudah
-- sepakat harga & jam, dan admin pun tidak boleh mengubahnya diam-diam. UPDATE-nya tetap satu
-- statement dengan `status <> 'booked'` supaya balapan dengan `book_slot` tertangkap row lock.

create or replace function public.update_slot(
  p_slot_id   uuid,
  p_price_idr int         default null,
  p_starts_at timestamptz default null,
  p_ends_at   timestamptz default null
)
returns public.slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.slots;
  v_owner uuid;
begin
  select e.photographer_id
    into v_owner
    from public.slots s
    join public.event_days d on d.id = s.event_day_id
    join public.events e     on e.id = d.event_id
   where s.id = p_slot_id;

  if not found then
    raise exception 'slot_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  update public.slots
     set price_idr = coalesce(p_price_idr, price_idr),
         starts_at = coalesce(p_starts_at, starts_at),
         ends_at   = coalesce(p_ends_at, ends_at)
   where id = p_slot_id
     and status <> 'booked'
  returning * into v_row;

  if not found then
    raise exception 'slot_booked' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_slot(uuid, int, timestamptz, timestamptz) from public;
revoke all on function public.update_slot(uuid, int, timestamptz, timestamptz) from anon;
grant execute on function public.update_slot(uuid, int, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_slot(uuid, int, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------- 3. delete_slot
--
-- Sama seperti 0006, plus cabang admin. `slot_booked` dipertahankan untuk kedua peran:
-- `bookings.slot_id` memakai `on delete cascade`, jadi menghapus slot terisi akan ikut
-- menghapus booking klien tanpa jejak. Urutan cek tetap ada → otorisasi → booked.

create or replace function public.delete_slot(p_slot_id uuid)
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
    from public.slots s
    join public.event_days d on d.id = s.event_day_id
    join public.events e     on e.id = d.event_id
   where s.id = p_slot_id;

  if not found then
    raise exception 'slot_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  delete from public.slots
   where id = p_slot_id
     and status <> 'booked';

  if not found then
    raise exception 'slot_booked' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.delete_slot(uuid) from public;
revoke all on function public.delete_slot(uuid) from anon;
grant execute on function public.delete_slot(uuid) to authenticated;
grant execute on function public.delete_slot(uuid) to service_role;

-- ---------------------------------------------------------------- 4. set_slot_status
--
-- Sama seperti 0004, plus cabang admin. Urutan cek dipertahankan: status valid → slot ada →
-- kepemilikan → booked. `invalid_status` dan `slot_booked` tetap berlaku untuk admin: slot
-- `booked` bersifat terminal, dan menutupnya akan membuat booking klien yatim.

create or replace function public.set_slot_status(
  p_slot_id uuid,
  p_status  text
)
returns public.slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.slots;
  v_owner uuid;
begin
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select e.photographer_id
    into v_owner
    from public.slots s
    join public.event_days d on d.id = s.event_day_id
    join public.events e     on e.id = d.event_id
   where s.id = p_slot_id;

  if not found then
    raise exception 'slot_not_found' using errcode = 'P0001';
  end if;

  if not (public.is_admin()
          or v_owner is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  -- Satu UPDATE, bukan select-lalu-update: kalau ada booking bersamaan pada slot
  -- yang sama, UPDATE menunggu row lock lalu mengevaluasi ulang `status <> 'booked'`
  -- terhadap versi baris terbaru. Nol baris = slot sudah booked.
  update public.slots
     set status = p_status
   where id = p_slot_id
     and status <> 'booked'
  returning * into v_row;

  if not found then
    raise exception 'slot_booked' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_slot_status(uuid, text) from public;
revoke all on function public.set_slot_status(uuid, text) from anon;
grant execute on function public.set_slot_status(uuid, text) to authenticated;
grant execute on function public.set_slot_status(uuid, text) to service_role;

-- ---------------------------------------------------------------- 5. unpublish_event
--
-- Sama seperti 0007, plus cabang admin. Kembali ke `draft`, bukan `closed`: `closed` adalah
-- penutupan permanen tanpa RPC pembuka, sedangkan tarik-terbit harus bisa diulang. Tidak ada
-- guard tambahan — event yang tidak ada sudah `event_not_found` sebelum cek otorisasi.

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

  if not (public.is_admin()
          or v_row.photographer_id is not distinct from public.current_photographer_id()) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

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

-- ---------------------------------------------------------------- 6. catatan apply
--
-- Dijalankan Deny lewat Supabase SQL Editor / dashboard (bukan `supabase db push`).
-- Aman dijalankan dua kali. Verifikasi cepat setelah apply:
--
--   select proname, pg_get_function_identity_arguments(oid) as args,
--          pg_get_function_result(oid) as result
--     from pg_proc
--    where proname in ('create_slot', 'update_slot', 'delete_slot',
--                      'set_slot_status', 'unpublish_event')
--    order by 1;
--   -- harapan: 5 baris, signature sama seperti sebelum 0014
--
--   select proname from pg_proc
--    where proname in ('create_slot', 'update_slot', 'delete_slot',
--                      'set_slot_status', 'unpublish_event')
--      and prosrc like '%is_admin()%'
--    order by 1;
--   -- harapan: 5 baris
