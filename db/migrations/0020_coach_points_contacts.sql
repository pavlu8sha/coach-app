-- Роли тренеров, шаг 3 (docs/COACH_ROLE_PLAN.md): ручные баллы тренера и контакты родителей своей группы.
-- Ручные баллы — только через функцию (от 1 до 5 за раз, комментарий обязателен, без отрицательных), поэтому прямая
-- вставка в журнал баллов у тренера закрывается: иначе через API можно было бы начислить любое число баллов.

-- Правило для ручных баллов. Число в правиле формальное: баллы записи задаёт тренер в пределах 1–5.
insert into rules (club_id, code, points, explanation, active_from)
  select id, 'coach_bonus', 1, 'Отметка тренера', date '2026-01-01' from clubs
  on conflict (club_id, code, version) do nothing;

drop policy points_insert on point_events;
create policy points_admin_insert on point_events for insert with check (is_admin());

-- Ручные баллы: игрок чем-то выделился. Родитель увидит комментарий как объяснение («за что»).
create or replace function award_bonus(p uuid, pts int, note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl players; rl rules; txt text := trim(coalesce(note, '')); eid uuid; day date := tbilisi_day(now());
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null then raise exception 'player not found'; end if;
  if not (is_admin() or is_coach_of_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if pts is null or pts < 1 or pts > 5 then raise exception 'points must be between 1 and 5'; end if;
  if txt = '' then raise exception 'note required'; end if;
  if char_length(txt) > 200 then raise exception 'note too long'; end if;
  rl := rule_for(pl.club_id, 'coach_bonus', day);
  if rl.id is null then raise exception 'rule coach_bonus not found'; end if;
  insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
    values (p, rl.id, pts, 'coach', gen_random_uuid(), day, txt) returning id into eid;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'award_bonus', 'point_events', eid, jsonb_build_object('player_id', p, 'points', pts, 'note', txt));
  return eid;
end $$;

-- Отменить ошибочный ручной балл (журнал напрямую не правится). Только ручные начисления, автоначисления не трогаем.
create or replace function revoke_bonus(e uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ev point_events;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into ev from point_events where id = e and source_type = 'coach';
  if ev.id is null then raise exception 'bonus not found'; end if;
  if not (is_admin() or is_coach_of_player(ev.player_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from point_events where id = e;
  insert into audit_log (actor_id, action, entity, entity_id, before)
    values (current_user_id(), 'revoke_bonus', 'point_events', e, to_jsonb(ev));
end $$;

-- Контакты родителей игроков группы: имя в Telegram и Telegram ID. Только тренер этой группы и администратор;
-- только родители с действующим согласием и только активные игроки.
create or replace function group_parents(g uuid)
returns table (player_id uuid, player_name text, parent_name text, telegram_id bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select pl.id, pl.full_name, u.display_name, u.telegram_id
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.consent_revoked_at is null
    join users u on u.id = pg.user_id
    where pl.group_id = g and pl.status = 'active'
    order by pl.full_name, u.display_name;
end $$;

revoke execute on function award_bonus(uuid, int, text), revoke_bonus(uuid), group_parents(uuid) from public;
grant execute on function award_bonus(uuid, int, text), revoke_bonus(uuid), group_parents(uuid) to authenticated;
