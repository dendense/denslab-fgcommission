-- 0006_slot_write_lock.sql — tabel `slots` jadi read-only; semua tulis lewat RPC
--
-- Isi:
--   1. Cabut grant insert/update/delete pada `public.slots` dari `authenticated` dan
--      `anon`. `select` dipertahankan (halaman publik + admin membacanya).
--   2. Hapus policy tulis `slots_owner_*` dari 0004 — tanpa grant, policy itu tidak
--      pernah dievaluasi; menyisakannya hanya mengundang orang memberi grant lagi.
--   3. Tiga RPC pengganti jalur tulis: `create_slot`, `update_slot`, `delete_slot`.
--      Semua `security definer`, `set search_path = public`, grant `authenticated` saja.
--
-- Asumsi:
--   * `0001_init.sql` … `0005_access_requests.sql` sudah dijalankan.
--     `current_photographer_id()` (0004) dipakai untuk cek kepemilikan.
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--   * `set_slot_status` (0002, user-scoped oleh 0004) TIDAK diubah di sini.
--
-- Idempotent: aman dijalankan ulang (create or replace / drop policy if exists /
-- revoke-grant eksplisit).
--
-- Latar belakang: aturan "slot `booked` bersifat terminal" hanya ditegakkan di
-- `set_slot_status`. Lewat PostgREST, pemilik slot masih bisa
--   PATCH /rest/v1/slots {status:'open'}   → slot booked jadi open (booking yatim)
--   PATCH /rest/v1/slots {price_idr:0}     → harga klien diubah setelah sepakat
--   POST  /rest/v1/slots {status:'booked'} → slot "booked" palsu tanpa booking
-- Karena itu tabelnya ditutup untuk tulis; satu-satunya pintu adalah RPC di bawah
-- (plus `set_slot_status` dan `book_slot` yang sudah ada).

-- ---------------------------------------------------------------- 1. cabut tulis langsung
--
-- `select` sengaja TIDAK dicabut: halaman publik (/e/[slug]) dan admin membaca
-- tabel ini, dan policy `slots_anon_select` / `slots_owner_select` tetap berlaku.

revoke insert, update, delete on table public.slots from authenticated;
revoke insert, update, delete on table public.slots from anon;

-- ---------------------------------------------------------------- 2. policy tulis mati
--
-- Policy di bawah ini (dari 0004) hanya bisa menyala kalau ada grant tulis. Grant-nya
-- baru saja dicabut, jadi mereka mati — dan kalau suatu saat grant dikembalikan tanpa
-- sengaja, policy ini yang akan langsung membuka jalur tulis. Dibuang sekarang.

drop policy if exists slots_owner_insert on public.slots;
drop policy if exists slots_owner_update on public.slots;
drop policy if exists slots_owner_delete on public.slots;

-- ---------------------------------------------------------------- 3a. create_slot
--
-- Slot baru selalu `status = 'open'`: slot `booked` hanya lahir dari `book_slot`.
-- Urutan cek: kepemilikan dulu, baru `seq` duplikat — supaya hari milik orang lain
-- tidak bisa dipakai untuk menebak seq mana yang sudah terpakai.
-- `not_owner` juga dipakai untuk hari yang tidak ada: dari sisi pemanggil, "tidak ada"
-- dan "bukan punyamu" sama-sama bukan urusannya.

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

  if v_owner is distinct from public.current_photographer_id() then
    raise exception 'not_owner' using errcode = 'P0001';
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

-- ---------------------------------------------------------------- 3b. update_slot
--
-- Hanya harga dan jam. `seq`, `event_day_id`, dan `status` tidak bisa diubah dari sini:
-- status punya RPC sendiri (`set_slot_status`), pindah hari = slot baru.
-- Argumen null = "jangan ubah", jadi satu RPC bisa dipakai untuk ubah harga saja,
-- jam saja, atau keduanya.
--
-- Slot `booked` ditolak: klien sudah sepakat harga & jam, mengubahnya setelah booking
-- = klien tertipu.
--
-- Urutan cek: ada → milik sendiri → booked. Sama seperti `set_slot_status`, supaya
-- status slot orang lain tidak bocor lewat pesan error.
-- UPDATE-nya satu statement dengan `status <> 'booked'`: kalau ada `book_slot`
-- bersamaan, UPDATE menunggu row lock lalu mengevaluasi ulang syarat itu terhadap
-- versi baris terbaru — nol baris berarti slot baru saja jadi booked.

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

  if v_owner is distinct from public.current_photographer_id() then
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

-- ---------------------------------------------------------------- 3c. delete_slot
--
-- Slot `booked` ditolak sebelum DELETE: `bookings.slot_id` memakai `on delete cascade`,
-- jadi menghapus slotnya akan ikut menghapus booking klien tanpa jejak.
-- Kembaliannya void — yang penting hanya berhasil atau exception.

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

  if v_owner is distinct from public.current_photographer_id() then
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

-- ---------------------------------------------------------------- 4. yang TIDAK diubah
--
-- * `set_slot_status` (0002 + 0004): aturannya sudah benar, yang berubah hanya
--   tabelnya tidak bisa ditulis langsung lagi.
-- * `book_slot`, `public_event`, `booking_by_token`, `admin_event`: tidak disentuh.
-- * `events` dan `event_days`: masih punya grant insert/update/delete untuk
--   `authenticated` (0004). Itu di luar cakupan kartu ini dan sengaja TIDAK diperbaiki
--   di sini — tapi perlu dicatat: pemilik event masih bisa mengubah `events.status`
--   dan `event_days.day_date/start_time/end_time` lewat PostgREST langsung.
