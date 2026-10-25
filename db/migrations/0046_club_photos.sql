-- Фото клуба, которые администратор может заменить в приложении («Ещё → Фото клуба»).
-- Исходные фото лежат в приложении (web/public/img); строка здесь заменяет фото с тем же ключом.
-- Фото хранится готовой data-URL (JPEG, сжатый в приложении до ~1200 px), без отдельного хранилища файлов.
-- Читают все вошедшие (фото из «О клубе» видит и гость), пишет только администратор через функции.
create table club_photos (
  key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  data text not null check (data like 'data:image/jpeg;base64,%' and length(data) <= 900000),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
alter table club_photos enable row level security;
create policy club_photos_read on club_photos for select using (current_user_id() is not null);
grant select on club_photos to authenticated, service_role;

create or replace function club_photo_set(k text, d text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if k is null or k !~ '^[a-z0-9-]{2,40}$' then raise exception 'bad key' using errcode = '22023'; end if;
  if d is null or d not like 'data:image/jpeg;base64,%' then raise exception 'bad image' using errcode = '22023'; end if;
  if length(d) > 900000 then raise exception 'image too large' using errcode = '22023'; end if;
  insert into club_photos (key, data, updated_by) values (k, d, current_user_id())
    on conflict (key) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- Вернуть исходное фото (удалить замену)
create or replace function club_photo_clear(k text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from club_photos where key = k;
end $$;

revoke all on function club_photo_set(text, text), club_photo_clear(text) from public, anon;
grant execute on function club_photo_set(text, text), club_photo_clear(text) to authenticated, service_role;
