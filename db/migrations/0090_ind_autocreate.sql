-- 0090: автосоздание индивидуальных и вратарских занятий на выходные (#336).
-- Шаблоны расписания (день недели + время + тип + темы по кругу), «постоянные» игроки по месяцам и функция ind_autocreate(),
-- которую раз в неделю (вторник) запускает pg_cron (db/ops/ind_autocreate_cron.sql, включает владелец).
-- Занятие создаётся с признаком auto; если админ удалил или перенёс автозанятие, пропуск запоминается и оно не воссоздаётся.
-- Запись постоянных на занятие обычная (ind_book): долг по записи, не пришедшего админ снимает/не снимает вручную (оплаченную убрать нельзя).
-- Повторный запуск безопасен: уникальность (club_id, external_id) и on conflict do nothing.

alter table individual_sessions add column if not exists auto boolean not null default false;

create table if not exists individual_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  isodow smallint not null check (isodow between 1 and 7),   -- 1 = понедельник … 6 = суббота, 7 = воскресенье
  start_time time not null,                                  -- местное время клуба (Asia/Tbilisi)
  goalkeepers boolean not null default false,
  topics text[] not null default '{}',                       -- темы по кругу, одна на неделю; пусто — без темы
  active boolean not null default true,
  unique (club_id, isodow, start_time, goalkeepers)
);

create table if not exists individual_slot_members (
  template_id uuid not null references individual_templates(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  primary key (template_id, player_id, month)
);

create table if not exists individual_skips (
  club_id uuid not null references clubs(id),
  external_id text not null,
  primary key (club_id, external_id)
);

alter table individual_templates enable row level security;
alter table individual_slot_members enable row level security;
alter table individual_skips enable row level security;
create policy individual_templates_admin on individual_templates for all using (is_admin()) with check (is_admin());
create policy individual_slot_members_admin on individual_slot_members for all using (is_admin()) with check (is_admin());
create policy individual_skips_admin on individual_skips for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on individual_templates, individual_slot_members, individual_skips to authenticated, service_role;

-- Стартовые шаблоны клуба (сб 19:00 и вс 18:00 — индивидуальные, вс 19:00 — вратарская)
insert into individual_templates (club_id, isodow, start_time, goalkeepers, topics)
select c.id, v.dow, v.t, v.gk, v.topics
from (select id from clubs order by id limit 1) c,
  (values
    (6::smallint, time '19:00', false, array['1 в 1 в ситуации соперник спереди', '1 в 1 в ситуации соперник сбоку', '1 в 1 в ситуации соперник сзади', 'Приём мяча и удары по воротам']),
    (7::smallint, time '18:00', false, array['1 в 1 в ситуации соперник спереди', '1 в 1 в ситуации соперник сбоку', '1 в 1 в ситуации соперник сзади', 'Приём мяча и удары по воротам']),
    (7::smallint, time '19:00', true,  array['Вратари'])
  ) as v(dow, t, gk, topics)
on conflict do nothing;

create or replace function ind_ext_id(d date, t time, gk boolean) returns text
language sql immutable as $$ select 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when gk then '-GK' else '' end $$;

-- Создаёт занятия по активным шаблонам на ближайшие 7 дней (включая сегодня) и записывает постоянных этого месяца.
-- from_d = null — «сегодня» по Asia/Tbilisi; уже прошедшее время сегодняшнего дня пропускается. Возвращает число созданных занятий.
create or replace function ind_autocreate(from_d date default null) returns int
language plpgsql security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; base date := coalesce(from_d, (now() at time zone 'Asia/Tbilisi')::date);
  r record; m record; d date; ext text; sid uuid; th text; n int := 0;
begin
  for r in select * from individual_templates where active loop
    d := base + ((r.isodow - extract(isodow from base)::int + 7) % 7);
    if from_d is null and (d + r.start_time) < local_now then continue; end if;
    ext := ind_ext_id(d, r.start_time, r.goalkeepers);
    if exists (select 1 from individual_skips where club_id = r.club_id and external_id = ext) then continue; end if;
    th := case when coalesce(array_length(r.topics, 1), 0) = 0 then null
               else r.topics[1 + ((d - date '2024-01-01') / 7) % array_length(r.topics, 1)] end;
    sid := null;
    insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers, auto)
    values (r.club_id, ext, d + r.start_time, th, r.goalkeepers, true)
    on conflict (club_id, external_id) do nothing returning id into sid;
    if sid is null then continue; end if;
    n := n + 1;
    for m in select sm.player_id from individual_slot_members sm join players pl on pl.id = sm.player_id
              where sm.template_id = r.id and sm.month = date_trunc('month', d)::date and pl.status = 'active' loop
      begin perform ind_book(sid, m.player_id); exception when others then null; end; -- переполнение мест не отменяет занятие
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function ind_autocreate(date) from public, anon, authenticated;
grant execute on function ind_autocreate(date) to service_role;

-- Кнопка администратора «Создать занятия на выходные» (то же самое вручную)
create or replace function ind_autocreate_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  return ind_autocreate(null);
end $$;
revoke execute on function ind_autocreate_now() from public, anon;
grant execute on function ind_autocreate_now() to authenticated;

-- Игрок постоянно ходит на слот шаблона в выбранном месяце. Включение записывает его на уже созданные будущие занятия слота,
-- выключение снимает только неоплаченные будущие записи этого слота (оплаченные и прошедшие не трогаем).
create or replace function ind_slot_member_set(tpl uuid, p uuid, mth date, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t individual_templates; m date := date_trunc('month', mth)::date; local_now timestamp := now() at time zone 'Asia/Tbilisi'; s record;
begin
  perform ind_assert_admin();
  select * into t from individual_templates where id = tpl;
  if not found then raise exception 'template not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from players where id = p and club_id = t.club_id) then raise exception 'player not in club' using errcode = '22023'; end if;
  if coalesce(on_, false) then
    insert into individual_slot_members (template_id, player_id, month) values (tpl, p, m) on conflict do nothing;
  else
    delete from individual_slot_members where template_id = tpl and player_id = p and month = m;
  end if;
  for s in select id from individual_sessions
            where club_id = t.club_id and goalkeepers = t.goalkeepers and extract(isodow from starts_at)::int = t.isodow
              and starts_at::time = t.start_time and date_trunc('month', starts_at)::date = m and starts_at > local_now loop
    if coalesce(on_, false) then
      begin perform ind_book(s.id, p); exception when others then null; end; -- уже записан или нет мест
    else
      delete from individual_bookings where session_id = s.id and player_id = p and not paid;
    end if;
  end loop;
end $$;
revoke execute on function ind_slot_member_set(uuid, uuid, date, boolean) from public, anon;
grant execute on function ind_slot_member_set(uuid, uuid, date, boolean) to authenticated;

-- Удаление автозанятия запоминается, чтобы вторничный запуск его не воссоздал
create or replace function ind_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if exists (select 1 from individual_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  if ses.auto then insert into individual_skips (club_id, external_id) values (ses.club_id, ses.external_id) on conflict do nothing; end if;
  delete from individual_sessions where id = s;
end $$;
revoke execute on function ind_delete_session(uuid) from public, anon;
grant execute on function ind_delete_session(uuid) to authenticated;

-- Перенос или смена типа автозанятия тоже запоминает прежний слот (иначе во вторник он создался бы заново)
create or replace function ind_edit_session(s uuid, d date, t time, theme text, gk boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text; new_gk boolean; cap int; n int;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  new_gk := coalesce(gk, ses.goalkeepers);
  if exists (select 1 from individual_bookings where session_id = s and paid) and (d + t) <> ses.starts_at then raise exception 'session has payments' using errcode = '22023'; end if;
  if new_gk <> ses.goalkeepers then
    cap := ind_cap(ses.club_id, new_gk);
    select count(*) into n from individual_bookings where session_id = s;
    if cap is not null and n > cap then raise exception 'session full' using errcode = '22023'; end if;
  end if;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when new_gk then '-GK' else '' end;
  if ext <> ses.external_id and exists (select 1 from individual_sessions where club_id = ses.club_id and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), ''), goalkeepers = new_gk where id = s;
  if ses.auto and ext <> ses.external_id then insert into individual_skips (club_id, external_id) values (ses.club_id, ses.external_id) on conflict do nothing; end if;
end $$;
revoke execute on function ind_edit_session(uuid, date, time, text, boolean) from public, anon;
grant execute on function ind_edit_session(uuid, date, time, text, boolean) to authenticated;
