-- Время начала и окончания индивидуальных и вратарских занятий, предупреждение о пересечении (Issue #274, PR 7).
-- Окончание необязательно: у старых занятий и шаблонов его нет, при проверке пересечений такое событие считается точкой начала.
-- Шаблонам окончание задаётся в individual_templates.end_time (автосоздание переносит его на занятие). Пересечение только предупреждает, запись не блокируется.

alter table individual_sessions add column ends_at timestamp;
alter table individual_sessions add constraint individual_sessions_ends_after_start check (ends_at is null or ends_at > starts_at);
alter table individual_templates add column end_time time;
alter table individual_templates add constraint individual_templates_end_after_start check (end_time is null or end_time > start_time);

-- Создание занятия: необязательное окончание
drop function if exists ind_create_session(date, time, boolean, text);
create function ind_create_session(d date, t time, gk boolean, theme text, t_end time default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; ext text;
begin
  perform ind_assert_admin();
  if d is null or t is null then raise exception 'date required' using errcode = '22023'; end if;
  if t_end is not null and t_end <= t then raise exception 'end before start' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when gk then '-GK' else '' end;
  if exists (select 1 from individual_sessions where club_id = c and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into individual_sessions (club_id, external_id, starts_at, ends_at, topic, goalkeepers)
  values (c, ext, (d + t), case when t_end is not null then d + t_end end, nullif(trim(theme), ''), coalesce(gk, false)) returning id into sid;
  return sid;
end $$;
revoke execute on function ind_create_session(date, time, boolean, text, time) from public, anon;
grant execute on function ind_create_session(date, time, boolean, text, time) to authenticated;

-- Правка занятия: необязательное окончание
drop function if exists ind_edit_session(uuid, date, time, text, boolean);
create function ind_edit_session(s uuid, d date, t time, theme text, gk boolean default null, t_end time default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text; new_gk boolean; cap int; n int; old_label text; pls uuid[];
begin
  perform ind_assert_admin();
  if t_end is not null and t_end <= t then raise exception 'end before start' using errcode = '22023'; end if;
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
  old_label := booking_session_label('individual', s);
  update individual_sessions set ends_at = case when t_end is not null then d + t_end end, starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), ''), goalkeepers = new_gk where id = s;
  if ses.auto and ext <> ses.external_id then insert into individual_skips (club_id, external_id) values (ses.club_id, ses.external_id) on conflict do nothing; end if;
  if (d + t) <> ses.starts_at or new_gk <> ses.goalkeepers or (case when t_end is not null then d + t_end end) is distinct from ses.ends_at then
    pls := array(select player_id from individual_bookings where session_id = s);
    perform booking_family_notice(ses.club_id, null, 'booking_changed', null, pls, 'Занятие изменено: было ' || old_label || ', теперь ' || booking_session_label('individual', s) || '. Запись сохранена; если новое время не подходит, отмените её в приложении. Записан(ы): ', '.');
  end if;
end $$;
revoke execute on function ind_edit_session(uuid, date, time, text, boolean, time) from public, anon;
grant execute on function ind_edit_session(uuid, date, time, text, boolean, time) to authenticated;

-- Автосоздание берёт окончание из шаблона
create or replace function ind_autocreate(from_d date default null) returns int
language plpgsql security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; base date := coalesce(from_d, (now() at time zone 'Asia/Tbilisi')::date);
  r record; m record; d date; first_d date; ext text; sid uuid; th text; n int := 0; booked uuid[]; dir text; free_pls uuid[]; cap int; busy int;
begin
  for r in select * from individual_templates where active loop
    first_d := base + ((r.isodow - extract(isodow from base)::int + 7) % 7);
    for d in select first_d + k * 7 from generate_series(0, case when first_d = base then 1 else 0 end) as k loop
      if from_d is null and (d + r.start_time) < local_now then continue; end if;
      ext := ind_ext_id(d, r.start_time, r.goalkeepers);
      if exists (select 1 from individual_skips where club_id = r.club_id and external_id = ext) then continue; end if;
      th := case when coalesce(array_length(r.topics, 1), 0) = 0 then null
                 else r.topics[1 + ((d - date '2024-01-01') / 7) % array_length(r.topics, 1)] end;
      sid := null;
      insert into individual_sessions (club_id, external_id, starts_at, ends_at, topic, goalkeepers, auto)
      values (r.club_id, ext, d + r.start_time, case when r.end_time is not null and r.end_time > r.start_time then d + r.end_time end, th, r.goalkeepers, true)
      on conflict (club_id, external_id) do nothing returning id into sid;
      if sid is null then continue; end if;
      n := n + 1;
      booked := '{}';
      for m in select sm.player_id from individual_slot_members sm join players pl on pl.id = sm.player_id
                where sm.template_id = r.id and sm.month = date_trunc('month', d)::date and pl.status = 'active' loop
        begin perform ind_book(sid, m.player_id); booked := booked || m.player_id; exception when others then null; end;
      end loop;
      -- Постоянным: автозапись (направлениям не подчиняется)
      perform booking_family_notice(r.club_id, null, 'booking_auto', sid, booked, 'Автозапись на ' || booking_session_label('individual', sid) || ': ', '. Отменить запись можно в приложении до начала тренировки.');
      -- Открытие записи: родителям с включённым направлением, чьи дети ещё не записаны и есть места
      dir := case when r.goalkeepers then 'goalkeeper' when r.isodow = 6 then 'ind_sat' when r.isodow = 7 then 'ind_sun' end;
      cap := ind_cap(r.club_id, r.goalkeepers);
      select count(*)::int into busy from individual_bookings where session_id = sid;
      if dir is not null and (cap is null or busy < cap) then
        free_pls := array(select pl.id from players pl where pl.club_id = r.club_id and pl.status = 'active'
                            and not exists (select 1 from individual_bookings b where b.session_id = sid and b.player_id = pl.id));
        perform booking_family_notice(r.club_id, dir, 'booking_open', sid, free_pls, 'Открыта запись: ' || booking_session_label('individual', sid) || '. Можно записать: ', '. Запись: «Расписание» → «Запись на занятия».');
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function ind_autocreate(date) from public, anon, authenticated;
grant execute on function ind_autocreate(date) to service_role;

-- Доска записи: у индивидуальных теперь есть окончание
drop function if exists booking_board();
create function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, ends_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb, eligible jsonb)
language plpgsql stable security definer set search_path = public as $$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at, s.ends_at,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    null::jsonb
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'),
    case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end, 'Дополнительная тренировка', e.place, extra_session_cap(e.id), e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    case when not e.targeted then null::jsonb
         else coalesce((select jsonb_agg(g.player_id) from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)), '[]'::jsonb) end
  from extra_sessions e where e.cancelled_at is null and e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
    and (is_admin() or not e.targeted
         or exists (select 1 from extra_bookings b where b.session_id = e.id and is_guardian_of(b.player_id))
         or exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)))
  order by 3, 1;
end $$;
revoke execute on function booking_board() from public, anon;
grant execute on function booking_board() to authenticated;

-- Пересечения: что ещё есть у ребёнка в это время. Только для опекуна (или админа). Группа, матч, индивидуальные, вратарские, дополнительные.
-- Событие без окончания считается минутой начала.
create or replace function booking_conflicts(k text, s uuid, p uuid)
returns table (kind text, label text, starts_at timestamp, ends_at timestamp)
language plpgsql stable security definer set search_path = public as $$
declare a_s timestamp; a_e timestamp; gid uuid;
begin
  if current_user_id() is null or not (is_admin() or is_guardian_of(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k = 'extra' then
    select e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end into a_s, a_e from extra_sessions e where e.id = s;
  else
    select i.starts_at, i.ends_at into a_s, a_e from individual_sessions i where i.id = s;
  end if;
  if a_s is null then return; end if;
  a_e := greatest(coalesce(a_e, a_s), a_s + interval '1 minute');
  select group_id into gid from players where id = p;
  return query
  select x.kind, x.label, x.s, x.e from (
    select case when i.goalkeepers then 'goalkeeper' else 'individual' end as kind,
           case when i.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end as label, i.starts_at as s, i.ends_at as e
      from individual_bookings b join individual_sessions i on i.id = b.session_id where b.player_id = p and i.id <> s
    union all
    select 'extra', 'Дополнительная тренировка', e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end
      from extra_bookings b join extra_sessions e on e.id = b.session_id where b.player_id = p and e.id <> s and e.cancelled_at is null
    union all
    select 'training', 'Тренировка группы', (t.starts_at at time zone 'Asia/Tbilisi'), null::timestamp
      from sessions t where gid is not null and t.group_id = gid and t.kind = 'training'
       and (t.starts_at at time zone 'Asia/Tbilisi') >= a_s - interval '1 day' and (t.starts_at at time zone 'Asia/Tbilisi') <= a_e + interval '1 day'
    union all
    select 'match', 'Матч: ' || m.team || coalesce(' — ' || m.opponent, ''), (m.starts_at at time zone 'Asia/Tbilisi'), null::timestamp
      from match_invitations mi join matches m on m.id = mi.match_id
     where mi.player_id = p and mi.status = 'invited' and mi.response is distinct from 'no' and m.starts_at is not null and m.lifecycle_status = 'published'
  ) x
  where x.s < a_e and a_s < greatest(coalesce(x.e, x.s), x.s + interval '1 minute')
  order by x.s;
end $$;
revoke execute on function booking_conflicts(text, uuid, uuid) from public, anon;
grant execute on function booking_conflicts(text, uuid, uuid) to authenticated;
