-- 0008_event_day_unique.sql — unique (event_id, day_date) di `public.event_days`
--
-- Isi:
--   1. Backfill: deteksi duplikat (event_id, day_date), tolak kalau ada pasangan yang
--      KEDUA barisnya punya slot, lalu hapus sisanya dengan aturan eksplisit.
--   2. Constraint `event_days_event_day_unique unique (event_id, day_date)` — ditegakkan DB.
--   3. `create_event_day` / `update_event_day` ditulis ulang: pemeriksaan `duplicate_day`
--      dari 0007 TETAP ada (pesannya lebih ramah), ditambah penangkap `unique_violation`
--      supaya balapan paralel keluar sebagai `duplicate_day`, bukan `23505` mentah.
--
-- Asumsi:
--   * `0001_init.sql` … `0007_event_write_lock.sql` sudah dijalankan.
--   * `event_days` bentuknya apa adanya dari 0001: (id uuid, event_id uuid, day_date date,
--     start_time time, end_time time). TIDAK ada kolom `created_at` — itu sebabnya aturan
--     pemilihan baris pemenang di bawah memakai "punya slot" lalu `id`, bukan "paling tua".
--   * Role `anon`, `authenticated`, `service_role` ada (Supabase default).
--
-- Idempotent: aman dijalankan ulang. Backfill jadi no-op setelah run pertama (tidak ada
-- duplikat tersisa), dan constraint hanya ditambahkan kalau belum ada.
--
-- Latar belakang: 0007 memeriksa tanggal dobel DI DALAM fungsi. Dua panggilan paralel
-- sama-sama melihat "belum ada", sama-sama insert, dua-duanya lolos — TOCTOU klasik.
-- Diukur di t_c9035c3c: 10 dari 12 round paralel menghasilkan dua baris (event_id,
-- day_date) identik. Yang bisa menutup itu hanya constraint, bukan `if exists` di fungsi.
--
-- Konsekuensi data: halaman publik menampilkan dua hari identik, slot klien terbagi ke dua
-- `event_day`, dan UI tidak punya cara memperbaikinya. Karena itu baris duplikat dibersihkan
-- di sini — dengan aturan yang tidak pernah membuang slot.

-- ---------------------------------------------------------------- 1a. deteksi duplikat
--
-- Query yang sama dipakai Deny di hosted SEBELUM apply (lihat catatan apply di komentar
-- terakhir file ini). Di sini hanya dokumentasi bentuk hasilnya:
--
--   select event_id, day_date, count(*)
--     from public.event_days
--    group by event_id, day_date
--   having count(*) > 1
--    order by 1, 2;

-- ---------------------------------------------------------------- 1b. tolak yang ambigu
--
-- Kalau dua baris untuk tanggal yang sama SAMA-SAMA punya slot, tidak ada pemenang yang
-- aman: memilih salah satu berarti slot di baris lain jadi yatim (dan cascade akan
-- menghapusnya). Jadi berhenti di sini, sebut event_id + day_date-nya, biar digabung manual.
-- Blok ini jalan SEBELUM delete apa pun, jadi kegagalan = nol baris terhapus.

do $$
declare
  v_bad text;
begin
  select string_agg(format('event_id=%s day_date=%s', x.event_id, x.day_date), '; ')
    into v_bad
    from (
      select d.event_id, d.day_date
        from public.event_days d
       where exists (select 1 from public.slots s where s.event_day_id = d.id)
       group by d.event_id, d.day_date
      having count(*) > 1
    ) x;

  if v_bad is not null then
    raise exception 'backfill_blocked_both_rows_have_slots: %', v_bad
      using errcode = 'P0001',
            hint = 'Gabungkan slot ke satu event_day secara manual, hapus baris lain, lalu jalankan 0008 lagi.';
  end if;
end $$;

-- ---------------------------------------------------------------- 1c. hapus duplikat
--
-- Aturan pemenang, eksplisit:
--   * baris yang punya slot selalu menang (slot klien tidak boleh ikut cascade);
--   * kalau tidak ada yang punya slot, `id` terkecil yang menang.
-- Kenapa `id`, bukan `created_at`: 0001 tidak punya kolom `created_at` di `event_days`, dan
-- menambah kolom hanya untuk urutan backfill itu perubahan skema yang tidak diminta. `id`
-- adalah uuid acak — "terkecil" tidak berarti "tertua", tapi deterministik dan cukup: yang
-- penting tepat satu baris bertahan dan hasilnya sama setiap kali dijalankan.
--
-- Karena 1b sudah menolak pasangan yang dua-duanya punya slot, baris berslot tidak pernah
-- terhapus di sini. Slot di baris yang dihapus: tidak ada (itu syarat delete-nya), jadi
-- cascade `slots → bookings` tidak menyentuh data klien.

do $$
declare
  v_deleted int;
begin
  delete from public.event_days d
   where exists (
     select 1
       from public.event_days k
      where k.event_id = d.event_id
        and k.day_date = d.day_date
        and k.id <> d.id
        and not exists (select 1 from public.slots s where s.event_day_id = d.id)
        and (
              exists (select 1 from public.slots s2 where s2.event_day_id = k.id)
              or k.id < d.id
            )
   );

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    raise notice '0008: % baris event_days duplikat dihapus (pemenang: baris berslot, kalau tidak ada maka id terkecil)', v_deleted;
  end if;
end $$;

-- ---------------------------------------------------------------- 1d. constraint
--
-- Ini yang benar-benar menutup balapan: mulai sekarang "satu tanggal satu baris" ditegakkan
-- DB, bukan oleh `if exists` di fungsi.
--
-- Idempotent: constraint-nya dicek dulu lewat `pg_constraint`. Tidak memakai `exception when
-- duplicate_object` karena `add constraint ... unique` membuat index dan Postgres melempar
-- 42P07 `duplicate_table` (relation already exists), bukan 42710 — menangkap yang salah berarti
-- run kedua gagal. Guard eksplisit juga tidak menelan error lain: kalau ada duplikat tersisa,
-- `add constraint` tetap gagal keras dengan menyebut key-nya, dan itu memang yang diinginkan.

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'event_days_event_day_unique'
       and conrelid = 'public.event_days'::regclass
  ) then
    alter table public.event_days
      add constraint event_days_event_day_unique unique (event_id, day_date);
  end if;
end $$;

-- ---------------------------------------------------------------- 2. create_event_day
--
-- Sama seperti 0007, plus satu hal: `exception when unique_violation`. Pemeriksaan
-- `duplicate_day` di atasnya tetap dipertahankan karena jalan tanpa perlu menunggu index
-- dan pesannya jelas; handler di bawah hanya menangkap kasus balapan, di mana dua transaksi
-- sama-sama lolos pemeriksaan dan yang kalah ditolak constraint.
--
-- Kenapa `exception` dan bukan `insert ... on conflict (event_id, day_date) do nothing`:
-- `on conflict` butuh constraint-nya sudah ada saat fungsi dibuat. Kalau 0008 dijalankan
-- setengah (fungsi jalan, constraint belum), `on conflict` langsung error 42P10 di setiap
-- panggilan. Dengan handler, fungsi tanpa constraint berperilaku persis seperti 0007 —
-- degradasi yang aman, bukan jalan mati.

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
exception
  when unique_violation then
    -- Balapan: transaksi lain menyisipkan (event_id, day_date) yang sama lebih dulu.
    raise exception 'duplicate_day' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_event_day(uuid, date, time, time) from public;
revoke all on function public.create_event_day(uuid, date, time, time) from anon;
grant execute on function public.create_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 3. update_event_day
--
-- Sama: pemeriksaan `duplicate_day` dari 0007 tetap, plus penangkap `unique_violation`.
-- Mengubah hari ke tanggalnya sendiri tidak menyentuh baris lain, jadi tidak ada
-- unique_violation dan hasilnya tetap 200 — bukan false positive.

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
exception
  when unique_violation then
    raise exception 'duplicate_day' using errcode = 'P0001';
end;
$$;

revoke all on function public.update_event_day(uuid, date, time, time) from public;
revoke all on function public.update_event_day(uuid, date, time, time) from anon;
grant execute on function public.update_event_day(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------- 4. yang TIDAK diubah
--
-- * `0001`–`0007` tidak disentuh sama sekali.
-- * `public_event` (0001), `book_slot` (0001), `booking_by_token` (0001): jalur publik/klien.
-- * `admin_event` (0003/0004), `set_slot_status` (0002/0004), `create_slot` / `update_slot` /
--   `delete_slot` (0006), `create_event` / `update_event` / `publish_event` /
--   `unpublish_event` / `delete_event` / `delete_event_day` (0007): tidak disentuh.
-- * Index `event_days_event_id_idx` (0001) dibiarkan walau sebagian tercakup index unique
--   baru — menghapusnya bukan bagian dari perbaikan ini.
--
-- ---------------------------------------------------------------- 5. catatan apply (untuk Deny)
--
-- Dijalankan manual lewat Supabase SQL editor, bukan `supabase db push`.
--
-- SEBELUM apply, jalankan di project hosted dan simpan hasilnya:
--
--   select event_id, day_date, count(*) as rows
--     from public.event_days
--    group by event_id, day_date
--   having count(*) > 1
--    order by 1, 2;
--
--   -- yang menentukan perlu-tidaknya intervensi manual:
--   select d.event_id, d.day_date, count(*) as rows_with_slots
--     from public.event_days d
--    where exists (select 1 from public.slots s where s.event_day_id = d.id)
--    group by d.event_id, d.day_date
--   having count(*) > 1
--    order by 1, 2;
--
-- Hasil pertama kosong  → apply langsung, 0008 tidak mengubah data apa pun.
-- Hasil pertama ada, kedua kosong → apply langsung; 0008 menghapus baris tanpa slot dan
--   mencetak `NOTICE: 0008: N baris event_days duplikat dihapus`.
-- Hasil kedua ada → JANGAN apply. 0008 akan gagal dengan
--   `backfill_blocked_both_rows_have_slots: event_id=… day_date=…` dan nol baris terhapus.
--   Gabungkan slot kedua baris ke satu `event_day` dulu, hapus baris lain, baru apply.
