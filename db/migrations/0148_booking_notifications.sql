-- Уведомления о записи на индивидуальные, вратарские и дополнительные тренировки (Issue #274, PR 5).
-- Все сообщения идут в общую очередь notifications (enqueue_notification учитывает общий выключатель родителя), реально их отправляет
-- Edge Function tg-notify по расписанию. Информационные рассылки по направлениям (открытие записи, приглашение на дополнительную)
-- дополнительно подчиняются настройкам направлений (0144). Подтверждения, автозапись, изменения и отмена направлениям не подчиняются.
-- Рассылка по семье: один родитель получает одно сообщение со списком своих детей. Повторы закрывает booking_notice_log.
-- ВАЖНО: пока клубная настройка booking.notify не равна «on», ничего не ставится в очередь (включает владелец отдельным решением).

create table booking_notice_log (
  kind text not null,
  ref_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id, user_id)
);
alter table booking_notice_log enable row level security; -- политик нет: только функции ниже
revoke all on booking_notice_log from public, anon, authenticated;
grant all on booking_notice_log to service_role;

create or replace function booking_notify_enabled(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lower(trim(value)) in ('on', 'true', '1', 'да') from club_settings where club_id = c and key = 'booking.notify' limit 1), false)
$$;

create or replace function booking_when(ts timestamp) returns text
language sql immutable set search_path = public as $$
  select (array['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])[extract(isodow from ts)::int] || ' ' || to_char(ts, 'DD.MM') || ' ' || to_char(ts, 'HH24:MI')
$$;

-- Название занятия для сообщений: «Индивидуальная тренировка, сб 14.11 19:00»
create or replace function booking_session_label(k text, s uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare i individual_sessions; e extra_sessions;
begin
  if k = 'extra' then
    select * into e from extra_sessions where id = s;
    if not found then return 'тренировка'; end if;
    return 'Дополнительная тренировка, ' || case when e.starts_time is null then to_char(e.starts_on, 'DD.MM') else booking_when(e.starts_on + e.starts_time) end
           || coalesce(', ' || e.place, '');
  end if;
  select * into i from individual_sessions where id = s;
  if not found then return 'тренировка'; end if;
  return case when i.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end || ', ' || booking_when(i.starts_at);
end $$;

-- Первое сообщение по ключу (вид, объект, получатель) возвращает true, повторные false
create or replace function booking_notice_once(k text, ref uuid, u uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into booking_notice_log (kind, ref_id, user_id) values (k, ref, u) on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Сообщение семьям: по одному на родителя, в тексте имена его детей из списка. direction = null — не зависит от настроек направлений.
-- ref = null — без защиты от повторов (изменения и подтверждения повторяются честно).
create or replace function booking_family_notice(c uuid, direction text, nk text, ref uuid, pls uuid[], head text, tail text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if c is null or not booking_notify_enabled(c) or coalesce(cardinality(pls), 0) = 0 then return; end if;
  for r in select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names
             from player_guardians g join players pl on pl.id = g.player_id
            where g.player_id = any(pls) and g.consent_revoked_at is null
            group by g.user_id loop
    if ref is not null and not booking_notice_once(nk, ref, r.user_id) then continue; end if;
    if direction is null then perform enqueue_notification(r.user_id, nk, head || r.names || tail);
    else perform enqueue_direction_notification(r.user_id, direction, nk, head || r.names || tail); end if;
  end loop;
end $$;
revoke execute on function booking_notify_enabled(uuid), booking_when(timestamp), booking_session_label(text, uuid), booking_notice_once(text, uuid, uuid),
  booking_family_notice(uuid, text, text, uuid, uuid[], text, text) from public, anon, authenticated;

-- Запись родителем: подтверждение семье
create or replace function booking_signup(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ex extra_sessions; now_local timestamp := now() at time zone 'Asia/Tbilisi'; nm text; cap int; st text;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select full_name, status into nm, st from players where id = p;
  if st is distinct from 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  if k in ('individual', 'goalkeeper') then
    select * into ses from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ses.starts_at < now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    perform ind_book(s, p);
  elsif k = 'extra' then
    select * into ex from extra_sessions where id = s for update;
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ex.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if ex.starts_time is not null and ex.starts_on + ex.starts_time <= now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    if not extra_eligible(s, p) then raise exception 'not eligible' using errcode = '22023'; end if;
    cap := extra_session_cap(s);
    if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform booking_family_notice((select club_id from players where id = p), null, 'booking_confirm', null, array[p], 'Запись подтверждена: ', ' — ' || booking_session_label(k, s) || '.');
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;
-- Запись администратором: подтверждение семье
create or replace function ind_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  perform ind_book(s, p);
  perform booking_family_notice((select club_id from players where id = p), null, 'booking_confirm', null, array[p], 'Запись подтверждена: ', ' — ' || booking_session_label('individual', s) || '.');
end $$;
revoke execute on function ind_add_player(uuid, uuid) from public, anon;
grant execute on function ind_add_player(uuid, uuid) to authenticated;

create or replace function extra_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; cap int; canc timestamptz;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id, cancelled_at into c, canc from extra_sessions where id = s for update;
  if c is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if canc is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := extra_session_cap(s);
  if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into extra_bookings (session_id, player_id) values (s, p);
  perform booking_family_notice(c, null, 'booking_confirm', null, array[p], 'Запись подтверждена: ', ' — ' || booking_session_label('extra', s) || '.');
end $$;

-- Автосоздание: автозапись постоянным и открытие записи
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
      insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers, auto)
      values (r.club_id, ext, d + r.start_time, th, r.goalkeepers, true)
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

-- Постоянный участник: одно сообщение о записи на будущие занятия месяца
create or replace function ind_slot_member_set(tpl uuid, p uuid, mth date, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t individual_templates; m date := date_trunc('month', mth)::date; local_now timestamp := now() at time zone 'Asia/Tbilisi'; s record; labels text[] := '{}';
begin
  perform ind_assert_admin();
  select * into t from individual_templates where id = tpl;
  if not found then raise exception 'template not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from players where id = p and club_id = t.club_id) then raise exception 'player not in club' using errcode = '22023'; end if;
  if coalesce(on_, false) and not exists (select 1 from players where id = p and status = 'active') then raise exception 'player not active' using errcode = '22023'; end if;
  if coalesce(on_, false) then
    insert into individual_slot_members (template_id, player_id, month) values (tpl, p, m) on conflict do nothing;
  else
    delete from individual_slot_members where template_id = tpl and player_id = p and month = m;
  end if;
  for s in select id from individual_sessions
            where club_id = t.club_id and goalkeepers = t.goalkeepers and extract(isodow from starts_at)::int = t.isodow
              and starts_at::time = t.start_time and date_trunc('month', starts_at)::date = m and starts_at > local_now loop
    if coalesce(on_, false) then
      begin perform ind_book(s.id, p); labels := labels || booking_session_label('individual', s.id); exception when others then null; end; -- уже записан или нет мест
    else
      delete from individual_bookings where session_id = s.id and player_id = p and not paid;
    end if;
  end loop;
  if coalesce(cardinality(labels), 0) > 0 then
    perform booking_family_notice(t.club_id, null, 'booking_auto', null, array[p], 'Постоянная запись: ', ' записан(а) на: ' || array_to_string(labels, '; ') || '. Отменить запись можно в приложении до начала тренировки.');
  end if;
end $$;
revoke execute on function ind_slot_member_set(uuid, uuid, date, boolean) from public, anon;
grant execute on function ind_slot_member_set(uuid, uuid, date, boolean) to authenticated;

-- Изменение занятия: сообщение записанным
create or replace function ind_edit_session(s uuid, d date, t time, theme text, gk boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text; new_gk boolean; cap int; n int; old_label text; pls uuid[];
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
  old_label := booking_session_label('individual', s);
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), ''), goalkeepers = new_gk where id = s;
  if ses.auto and ext <> ses.external_id then insert into individual_skips (club_id, external_id) values (ses.club_id, ses.external_id) on conflict do nothing; end if;
  if (d + t) <> ses.starts_at or new_gk <> ses.goalkeepers then
    pls := array(select player_id from individual_bookings where session_id = s);
    perform booking_family_notice(ses.club_id, null, 'booking_changed', null, pls, 'Занятие изменено: было ' || old_label || ', теперь ' || booking_session_label('individual', s) || '. Запись сохранена; если новое время не подходит, отмените её в приложении. Записан(ы): ', '.');
  end if;
end $$;
revoke execute on function ind_edit_session(uuid, date, time, text, boolean) from public, anon;
grant execute on function ind_edit_session(uuid, date, time, text, boolean) to authenticated;

-- Удаление (отмена) занятия: сообщение записанным
create or replace function ind_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; lbl text; pls uuid[];
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if exists (select 1 from individual_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  lbl := booking_session_label('individual', s);
  pls := array(select player_id from individual_bookings where session_id = s);
  if ses.auto then insert into individual_skips (club_id, external_id) values (ses.club_id, ses.external_id) on conflict do nothing; end if;
  delete from individual_sessions where id = s;
  perform booking_family_notice(ses.club_id, null, 'booking_cancelled', null, pls, 'Занятие отменено: ' || lbl || '. Записан(ы): ', '.');
end $$;
revoke execute on function ind_delete_session(uuid) from public, anon;
grant execute on function ind_delete_session(uuid) to authenticated;

-- Приглашение на дополнительную: родителям целевых групп и приглашённых (настройка направления «дополнительные»)
create or replace function extra_create_session(d date, amt numeric, plc text, grps uuid[] default null, pls uuid[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; g uuid; pl uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  insert into extra_sessions (club_id, starts_on, amount, place, targeted)
    values (c, d, amt, nullif(trim(plc), ''), coalesce(cardinality(grps), 0) + coalesce(cardinality(pls), 0) > 0) returning id into sid;
  foreach g in array coalesce(grps, '{}') loop
    if not exists (select 1 from groups where id = g and club_id = c) then raise exception 'group not found' using errcode = 'P0002'; end if;
    insert into extra_session_groups (session_id, group_id, added_by) values (sid, g, current_user_id()) on conflict do nothing;
  end loop;
  foreach pl in array coalesce(pls, '{}') loop
    if not exists (select 1 from players where id = pl and club_id = c) then raise exception 'player not in club' using errcode = '22023'; end if;
    insert into extra_session_players (session_id, player_id, added_by) values (sid, pl, current_user_id()) on conflict do nothing;
  end loop;
  perform booking_family_notice(c, 'extra', 'booking_extra_invite', sid, array(select r.player_id from extra_recipients(sid) r), 'Дополнительная тренировка: ' || booking_session_label('extra', sid) || '. Приглашены: ', '. Запись: «Расписание» → «Запись на занятия».');
  perform extra_log(sid, 'created', jsonb_build_object('starts_on', d, 'amount', amt, 'place', nullif(trim(plc), ''), 'groups', coalesce(grps, '{}'), 'players', coalesce(pls, '{}')));
  return sid;
end $$;
revoke execute on function extra_create_session(date, numeric, text, uuid[], uuid[]) from public, anon;
grant execute on function extra_create_session(date, numeric, text, uuid[], uuid[]) to authenticated;

-- Изменение даты и места дополнительной: сообщение записанным
create or replace function extra_edit_session(s uuid, d date, amt numeric, plc text) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; old_label text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt <> ses.amount and exists (select 1 from extra_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  old_label := booking_session_label('extra', s);
  update extra_sessions set starts_on = d, amount = amt, place = nullif(trim(plc), '') where id = s;
  if d <> ses.starts_on or amt <> ses.amount or nullif(trim(plc), '') is distinct from ses.place then
    perform extra_log(s, 'edited', jsonb_build_object('before', jsonb_build_object('starts_on', ses.starts_on, 'amount', ses.amount, 'place', ses.place),
                                                      'after', jsonb_build_object('starts_on', d, 'amount', amt, 'place', nullif(trim(plc), ''))));
  end if;
  if d <> ses.starts_on or nullif(trim(plc), '') is distinct from ses.place then
    perform booking_family_notice(ses.club_id, null, 'booking_changed', null, array(select player_id from extra_bookings where session_id = s),
      'Тренировка изменена: было ' || old_label || ', теперь ' || booking_session_label('extra', s) || '. Запись сохранена; если новые условия не подходят, отмените её в приложении. Записан(ы): ', '.');
  end if;
end $$;
-- Изменение времени дополнительной: сообщение записанным
create or replace function extra_set_time(s uuid, t_start time, t_end time) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; old_label text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if t_end is not null and t_start is null then raise exception 'start required' using errcode = '22023'; end if;
  if t_start is not null and t_end is not null and t_end <= t_start then raise exception 'end before start' using errcode = '22023'; end if;
  old_label := booking_session_label('extra', s);
  update extra_sessions set starts_time = t_start, ends_time = t_end where id = s;
  if t_start is distinct from ses.starts_time or t_end is distinct from ses.ends_time then
    perform extra_log(s, 'time_set', jsonb_build_object('before', jsonb_build_object('starts_time', ses.starts_time, 'ends_time', ses.ends_time),
                                                       'after', jsonb_build_object('starts_time', t_start, 'ends_time', t_end)));
    perform booking_family_notice(ses.club_id, null, 'booking_changed', null, array(select player_id from extra_bookings where session_id = s),
      'Тренировка изменена: было ' || old_label || ', теперь ' || booking_session_label('extra', s) || '. Запись сохранена; если новое время не подходит, отмените её в приложении. Записан(ы): ', '.');
  end if;
end $$;
-- Отмена дополнительной клубом: сообщение записанным
create or replace function extra_cancel_session(s uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int; lbl text; pls uuid[];
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  lbl := booking_session_label('extra', s);
  pls := array(select player_id from extra_bookings where session_id = s and attended is null);
  update extra_sessions set cancelled_at = clock_timestamp(), cancelled_by = current_user_id(), cancel_reason = nullif(trim(p_reason), '') where id = s;
  insert into booking_cancellations (club_id, kind, session_id, player_id, starts_at, label, amount, status, cancelled_by)
    select ses.club_id, 'extra', s, b.player_id, ses.starts_on::timestamp + coalesce(ses.starts_time, time '00:00'), ses.place,
           case when b.paid then coalesce(b.paid_amount, ses.amount) else 0 end, case when b.paid then 'awaiting' else 'cancelled' end, current_user_id()
      from extra_bookings b where b.session_id = s and b.attended is null;
  get diagnostics n = row_count;
  delete from extra_bookings where session_id = s and attended is null;
  perform booking_family_notice(ses.club_id, null, 'booking_cancelled', null, pls, 'Тренировка отменена: ' || lbl || coalesce('. Причина: ' || nullif(trim(p_reason), ''), '') || '. Записан(ы): ', '. Оплата, если была, сохранена: администратор свяжется с вами.');
  perform extra_log(s, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'bookings', n));
end $$;
revoke execute on function extra_cancel_session(uuid, text) from public, anon;
grant execute on function extra_cancel_session(uuid, text) to authenticated;

-- Группа добавлена к занятию: приглашение родителям новых участников
create or replace function extra_target_group(s uuid, g uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int := 0; newp uuid[];
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if not exists (select 1 from groups where id = g and club_id = ses.club_id) then raise exception 'group not found' using errcode = 'P0002'; end if;
  if coalesce(on_, false) then
    newp := array(select pl.id from players pl where pl.group_id = g and pl.status = 'active'
                    and not exists (select 1 from extra_session_groups x where x.session_id = s and x.group_id = pl.group_id)
                    and not exists (select 1 from extra_session_players x where x.session_id = s and x.player_id = pl.id));
    insert into extra_session_groups (session_id, group_id, added_by) values (s, g, current_user_id()) on conflict do nothing;
    update extra_sessions set targeted = true where id = s;
    perform extra_log(s, 'target_group_added', jsonb_build_object('group_id', g));
    perform booking_family_notice(ses.club_id, 'extra', 'booking_extra_invite', s, newp, 'Дополнительная тренировка: ' || booking_session_label('extra', s) || '. Приглашены: ', '. Запись: «Расписание» → «Запись на занятия».');
  else
    delete from extra_session_groups where session_id = s and group_id = g;
    select count(*)::int into n from extra_bookings b where b.session_id = s and not extra_eligible(s, b.player_id)
       and exists (select 1 from players pl where pl.id = b.player_id and pl.group_id = g);
    perform extra_log(s, 'target_group_removed', jsonb_build_object('group_id', g, 'bookings_without_access', n));
  end if;
  return n;
end $$;
revoke execute on function extra_target_group(uuid, uuid, boolean) from public, anon;
grant execute on function extra_target_group(uuid, uuid, boolean) to authenticated;

-- Игрок приглашён персонально: сообщение его родителям
create or replace function extra_target_player(s uuid, p uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int := 0; was_target boolean;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if not exists (select 1 from players where id = p and club_id = ses.club_id) then raise exception 'player not in club' using errcode = '22023'; end if;
  if coalesce(on_, false) then
    was_target := exists (select 1 from extra_session_players x where x.session_id = s and x.player_id = p)
               or exists (select 1 from extra_session_groups x join players pl on pl.group_id = x.group_id where x.session_id = s and pl.id = p);
    insert into extra_session_players (session_id, player_id, added_by) values (s, p, current_user_id()) on conflict do nothing;
    update extra_sessions set targeted = true where id = s;
    perform extra_log(s, 'target_player_added', jsonb_build_object('player_id', p));
    if not was_target then
      perform booking_family_notice(ses.club_id, 'extra', 'booking_extra_invite', s, array[p], 'Дополнительная тренировка: ' || booking_session_label('extra', s) || '. Приглашены: ', '. Запись: «Расписание» → «Запись на занятия».');
    end if;
  else
    delete from extra_session_players where session_id = s and player_id = p;
    select count(*)::int into n from extra_bookings b where b.session_id = s and b.player_id = p and not extra_eligible(s, p);
    perform extra_log(s, 'target_player_removed', jsonb_build_object('player_id', p, 'bookings_without_access', n));
  end if;
  return n;
end $$;
revoke execute on function extra_target_player(uuid, uuid, boolean) from public, anon;
grant execute on function extra_target_player(uuid, uuid, boolean) to authenticated;
