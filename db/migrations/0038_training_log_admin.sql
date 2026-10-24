-- Учёт проведённых тренировок и часов тренеров для администратора (перенос из старого приложения: GamesNew.js,
-- страница «Посещаемость тренеров»). Таблица training_log — миграция 0009 (только администратор). Одна строка — один тренер
-- на одной тренировке; часы считаются по времени начала и конца. Ключ строки: дата|тренер|группа|начало|номер.
-- Правила в функциях: только администратор; будущие тренировки не подтверждаются; уже подтверждённую тренировку
-- (группа + время) повторным подтверждением не дублируем.
create or replace function tl_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function tl_hours(st time, en time) returns numeric
language sql immutable as $$ select case when st is null or en is null or en <= st then 0 else round(extract(epoch from (en - st)) / 360)::numeric / 10 end $$;

create or replace function tl_key(d date, coach text, label text, st time) returns text
language sql immutable as $$ select d::text || '|' || coach || '|' || label || '|' || coalesce(to_char(st, 'HH24:MI'), '') $$;

-- Добавить строку (тренер на тренировке)
create or replace function tl_add(d date, coach text, label text, kind text, st time, en time, loc text, is_held boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid; n int; base text;
begin
  perform tl_assert_admin();
  if d is null or nullif(trim(coach), '') is null or nullif(trim(label), '') is null then raise exception 'fields required' using errcode = '22023'; end if;
  if kind not in ('Групповая', 'Индивидуальная', 'Вратарская') then raise exception 'bad kind' using errcode = '22023'; end if;
  if coalesce(is_held, true) and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  base := tl_key(d, trim(coach), trim(label), st);
  select count(*) + 1 into n from training_log where club_id = c and external_id like base || '|%';
  insert into training_log (club_id, external_id, held_on, weekday, coach, location, group_label, kind, starts_at, ends_at, hours, held)
  values (c, base || '|' || n, d, (array['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])[extract(isodow from d)::int], trim(coach), nullif(trim(loc), ''), trim(label), kind, st, en, tl_hours(st, en), coalesce(is_held, true))
  returning id into r;
  return r;
end $$;

-- Подтвердить плановую тренировку: по строке на каждого тренера; существующие отметки «Нет» превращаются в «Да»
create or replace function tl_confirm(d date, label text, kind text, st time, en time, loc text, coaches text[]) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid; t text; done int := 0; rid uuid;
begin
  perform tl_assert_admin();
  if d is null or nullif(trim(label), '') is null or coaches is null or array_length(coaches, 1) is null then raise exception 'fields required' using errcode = '22023'; end if;
  if d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  if exists (select 1 from training_log where club_id = c and held_on = d and group_label = trim(label) and starts_at is not distinct from st and held) then return 0; end if;
  foreach t in array coaches loop
    continue when nullif(trim(t), '') is null;
    select id into rid from training_log where club_id = c and held_on = d and group_label = trim(label) and starts_at is not distinct from st and coach = trim(t) and not held limit 1;
    if rid is not null then
      update training_log set held = true where id = rid;
    else
      perform tl_add(d, t, label, kind, st, en, loc, true);
    end if;
    done := done + 1;
  end loop;
  return done;
end $$;

create or replace function tl_set_held(i uuid, is_held boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform tl_assert_admin();
  update training_log set held = coalesce(is_held, false) where id = i;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;

-- Заменить тренера в строке
create or replace function tl_replace_coach(i uuid, new_coach text) returns void
language plpgsql security definer set search_path = public as $$
declare r training_log; base text; n int;
begin
  perform tl_assert_admin();
  if nullif(trim(new_coach), '') is null then raise exception 'fields required' using errcode = '22023'; end if;
  select * into r from training_log where id = i;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if exists (select 1 from training_log where club_id = r.club_id and held_on = r.held_on and group_label = r.group_label and starts_at is not distinct from r.starts_at and coach = trim(new_coach) and id <> i) then
    raise exception 'coach already in' using errcode = '23505';
  end if;
  base := tl_key(r.held_on, trim(new_coach), r.group_label, r.starts_at);
  select count(*) + 1 into n from training_log where club_id = r.club_id and external_id like base || '|%';
  update training_log set coach = trim(new_coach), external_id = base || '|' || n where id = i;
end $$;

revoke execute on function tl_assert_admin(), tl_hours(time, time), tl_key(date, text, text, time) from public, anon, authenticated;
revoke execute on function tl_add(date, text, text, text, time, time, text, boolean), tl_confirm(date, text, text, time, time, text, text[]),
  tl_set_held(uuid, boolean), tl_replace_coach(uuid, text) from public, anon;
grant execute on function tl_add(date, text, text, text, time, time, text, boolean), tl_confirm(date, text, text, time, time, text, text[]),
  tl_set_held(uuid, boolean), tl_replace_coach(uuid, text) to authenticated;
