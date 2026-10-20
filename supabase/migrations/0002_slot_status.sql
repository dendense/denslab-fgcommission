-- 0002_slot_status.sql — RPC admin untuk membuka/menutup satu slot
--
-- Isi: satu fungsi `set_slot_status(p_slot_id uuid, p_status text)` yang dipakai
--      PATCH /api/admin/slots/[slotId].
--
-- Asumsi:
--   * `0001_init.sql` sudah dijalankan (tabel public.slots + kolom status ada).
--   * Role `anon` dan `service_role` ada (Supabase default).
--   * Service role key hanya dipakai server-side di API route, tidak pernah ke browser.
--
-- Idempotent: aman dijalankan ulang (create or replace + revoke/grant eksplisit).
--
-- ATURAN:
--   * p_status hanya 'open' atau 'closed'. Selain itu → exception `invalid_status`.
--   * Slot yang sudah `booked` TIDAK boleh diubah statusnya → exception `slot_booked`.
--     Alasannya: klien sudah memegang booking (bookings.slot_id unique). Menutup
--     slotnya akan membuat booking yatim — klien punya konfirmasi untuk sesi yang
--     hilang dari halaman publik, dan tidak ada jalur di aplikasi untuk
--     mengembalikan/membatalkannya. Membuka kembali slot `booked` juga ditolak
--     dengan alasan yang sama (slot `open` + booking hidup = slot bisa ter-booking
--     dua kali). Jadi `booked` bersifat terminal di fungsi ini.
--   * Grant: nol untuk anon/authenticated. Hanya service_role, sama seperti book_slot.

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
  v_row public.slots;
begin
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  -- Satu UPDATE, bukan select-lalu-update: kalau ada booking bersamaan pada slot
  -- yang sama, UPDATE menunggu row lock lalu mengevaluasi ulang `status <> 'booked'`
  -- terhadap versi baris terbaru. Nol baris = slot sudah booked (atau tidak ada).
  update public.slots
     set status = p_status
   where id = p_slot_id
     and status <> 'booked'
  returning * into v_row;

  if not found then
    if exists (select 1 from public.slots where id = p_slot_id) then
      raise exception 'slot_booked' using errcode = 'P0001';
    end if;
    raise exception 'slot_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_slot_status(uuid, text) from public;
revoke all on function public.set_slot_status(uuid, text) from anon, authenticated;
grant execute on function public.set_slot_status(uuid, text) to service_role;
