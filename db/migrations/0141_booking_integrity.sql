-- #274, сценарии A и B (PR 2): надёжность записи на индивидуальные, вратарские и дополнительные тренировки.
--  * ind_book блокирует строку занятия: две одновременные записи не превысят вместимость (раньше число записанных считалось без блокировки);
--  * родитель не записывает ребёнка, у которого статус не «Занимается» (пауза, ушёл); админ и автозапись работают как раньше;
--  * запись на дополнительную тренировку закрывается в момент начала, если задано starts_time (без времени остаётся «до конца дня»);
--  * постоянным нельзя назначить игрока не в статусе «Занимается» (автосоздание их и так пропускает);
--  * ind_regulars_overflow: для админа список слотов, где постоянных больше мест (предупреждение, без блокировки, спецификация A7).

create or replace function ind_book(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; cap int; n int; pc uuid;
begin
  select * into ses from individual_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> ses.club_id then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from individual_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := ind_cap(ses.club_id, ses.goalkeepers);
  select count(*) into n from individual_bookings where session_id = s;
  if cap is not null and n >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into individual_bookings (session_id, player_id, amount, paid) values (s, p, ind_price(ses.club_id, ses.starts_at::date), false);
end $$;

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
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if ex.starts_time is not null and ex.starts_on + ex.starts_time <= now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    cap := extra_cap(ex.club_id);
    if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

create or replace function ind_slot_member_set(tpl uuid, p uuid, mth date, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t individual_templates; m date := date_trunc('month', mth)::date; local_now timestamp := now() at time zone 'Asia/Tbilisi'; s record;
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
      begin perform ind_book(s.id, p); exception when others then null; end; -- уже записан или нет мест
    else
      delete from individual_bookings where session_id = s.id and player_id = p and not paid;
    end if;
  end loop;
end $$;

-- Слоты, где постоянных на месяц больше мест. Только администратор. Ничего не блокирует, только предупреждает.
create or replace function ind_regulars_overflow(mth date) returns table (template_id uuid, regulars int, cap int)
language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', mth)::date;
begin
  perform ind_assert_admin();
  return query
    select t.id, count(sm.player_id)::int, ind_cap(t.club_id, t.goalkeepers)
      from individual_templates t join individual_slot_members sm on sm.template_id = t.id and sm.month = m
     where t.active
     group by t.id, t.club_id, t.goalkeepers
    having ind_cap(t.club_id, t.goalkeepers) is not null and count(sm.player_id) > ind_cap(t.club_id, t.goalkeepers);
end $$;
revoke execute on function ind_regulars_overflow(date) from public, anon;
grant execute on function ind_regulars_overflow(date) to authenticated;
