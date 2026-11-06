-- Подтверждение участия в матчах, PR 4 (Issue #274, ТЗ §6): уведомления родителям при изменении данных опубликованного матча
-- (время в пределах дня, место, адрес, заметка, соперник) и при исключении игрока из состава; одно общее сообщение на семью
-- за одну операцию (несколько приглашённых или исключённых детей одного родителя). Остальное из 0137 не меняется.

drop trigger if exists match_invitations_notify on match_invitations;
drop function if exists rsvp_invitation_notify();
drop function if exists rsvp_notify_match(uuid, text);
drop function if exists rsvp_notify_parent(uuid, uuid, text, uuid);

-- Сообщение одному родителю. k: invite, reschedule, reminder, cancel, update (изменены данные), removed (исключён из состава).
-- only_players — только эти дети; changes — строки «что изменилось» для update.
-- Кнопки ответа: invite, reschedule — на каждого ребёнка; reminder — на не ответивших; update — тоже на не ответивших (ответы сохраняются).
create or replace function rsvp_notify_parent(m uuid, u uuid, k text, only_players uuid[] default null, changes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; r record; names text := ''; btn jsonb := '[]'::jsonb; head text; body text; first_name text;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status not in ('published', 'cancelled') then return; end if;
  for r in
    select i.id as inv, p.full_name, i.response
      from match_invitations i
      join players p on p.id = i.player_id
      join player_guardians g on g.player_id = i.player_id and g.user_id = u and g.consent_revoked_at is null
     where i.match_id = m and i.status = case when k = 'removed' then 'removed' else 'invited' end
       and (only_players is null or i.player_id = any (only_players))
       and (k <> 'reminder' or i.response is null)
     order by p.full_name
  loop
    names := names || case when names = '' then '' else ', ' end || r.full_name;
    if k in ('invite', 'reschedule', 'reminder', 'update') and mt.lifecycle_status = 'published' and (k in ('invite', 'reschedule') or r.response is null) then
      first_name := coalesce(nullif(split_part(r.full_name, ' ', 2), ''), r.full_name);
      btn := btn || jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text', first_name || ': Будет', 'data', 'r:' || r.inv || ':y'),
        jsonb_build_object('text', first_name || ': Не будет', 'data', 'r:' || r.inv || ':n')));
    end if;
  end loop;
  if names = '' then return; end if;
  head := case k when 'invite' then '⚽ Приглашение на матч' when 'reschedule' then '📅 Матч перенесён' when 'cancel' then '❌ Матч отменён'
                 when 'update' then 'ℹ️ Изменились данные матча' when 'removed' then '➖ Игрок исключён из состава на матч' else '⏰ Напоминание о матче' end;
  body := head || E'\n' || mt.team || ' · ' || coalesce(mt.opponent, 'соперник уточняется')
       || E'\n' || rsvp_when(mt.starts_at)
       || coalesce(E'\n' || nullif(concat_ws(', ', mt.venue, mt.address), ''), '')
       || coalesce(E'\n' || mt.notes, '')
       || E'\nИгрок: ' || names;
  if k = 'cancel' then
    body := body || coalesce(E'\nПричина: ' || nullif(mt.cancel_reason, ''), '');
  elsif k = 'update' then
    body := body || coalesce(E'\n\nЧто изменилось:\n' || changes, '') || E'\nПрежние ответы сохранены.';
  elsif k = 'removed' then
    null;
  else
    body := body || case k when 'reschedule' then E'\nПрежние ответы сброшены, ответьте заново' when 'reminder' then E'\nВы ещё не ответили' else E'\nПожалуйста, ответьте' end
         || ' до ' || rsvp_when(match_rsvp_answer_until(mt.starts_at)) || '.';
  end if;
  if exists (select 1 from users where id = u and notifications_enabled) then
    insert into notifications (user_id, kind, text, buttons) values (u, 'rsvp_' || k, body, nullif(btn, '[]'::jsonb));
  end if;
end $$;

-- Всем родителям приглашённых детей: одно сообщение каждому со всеми его детьми
create or replace function rsvp_notify_match(m uuid, k text, changes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in
    select distinct g.user_id from match_invitations i
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' order by g.user_id
  loop
    perform rsvp_notify_parent(m, u, k, null, changes);
  end loop;
end $$;

-- Родителям затронутых детей одной операции: по одному сообщению на родителя, в нём все его затронутые дети
create or replace function rsvp_notify_players(m uuid, k text, players uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not exists (select 1 from matches mt where mt.id = m and mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()) then return; end if;
  for u in select distinct g.user_id from player_guardians g where g.player_id = any (players) and g.consent_revoked_at is null order by g.user_id loop
    perform rsvp_notify_parent(m, u, k, players);
  end loop;
end $$;

-- Приглашения и исключения игроков выполняются функциями построчно (match_rsvp_invite / match_rsvp_remove). Чтобы за одну операцию
-- родитель получил одно сообщение, каждое событие сначала записывается в очередь событий, а отложенный триггер в конце транзакции
-- собирает их по матчу и виду и отправляет одним вызовом rsvp_notify_players.
create table rsvp_notice_stage (
  id bigint generated always as identity primary key,
  txid bigint not null default txid_current(),
  match_id uuid not null,
  player_id uuid not null,
  kind text not null check (kind in ('invite', 'removed'))
);
alter table rsvp_notice_stage enable row level security; -- политик нет: пишут и читают только функции ниже
revoke all on rsvp_notice_stage from public, anon, authenticated;

create or replace function rsvp_invitations_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'invited' and (tg_op = 'INSERT' or old.status = 'removed') then
    insert into rsvp_notice_stage (match_id, player_id, kind) values (new.match_id, new.player_id, 'invite');
  elsif tg_op = 'UPDATE' and old.status = 'invited' and new.status = 'removed' then
    insert into rsvp_notice_stage (match_id, player_id, kind) values (new.match_id, new.player_id, 'removed');
  end if;
  return null;
end $$;
create trigger match_invitations_stage after insert or update of status on match_invitations
  for each row execute function rsvp_invitations_stage();

-- Выполняется в конце транзакции (первый вызов забирает все накопленные события транзакции, остальные ничего не находят)
create or replace function rsvp_notice_flush() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    with d as (delete from rsvp_notice_stage where txid = txid_current() returning match_id, kind, player_id)
    select match_id, kind, array_agg(player_id order by player_id) as players from d group by match_id, kind order by match_id, kind
  loop
    perform rsvp_notify_players(r.match_id, r.kind, r.players);
  end loop;
  return null;
end $$;
create constraint trigger rsvp_notice_flush after insert on rsvp_notice_stage
  deferrable initially deferred for each row execute function rsvp_notice_flush();

-- Изменены данные опубликованного матча без переноса: что именно изменилось — в тексте
create or replace function rsvp_matches_details_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare ch text := '';
  nz constant text := 'не указано';
begin
  if new.opponent is distinct from old.opponent then ch := ch || E'▸ Соперник: ' || coalesce(old.opponent, nz) || ' → ' || coalesce(new.opponent, nz) || E'\n'; end if;
  if new.starts_at is distinct from old.starts_at then ch := ch || E'▸ Время: ' || rsvp_when(old.starts_at) || ' → ' || rsvp_when(new.starts_at) || E'\n'; end if;
  if new.venue is distinct from old.venue then ch := ch || E'▸ Место: ' || coalesce(old.venue, nz) || ' → ' || coalesce(new.venue, nz) || E'\n'; end if;
  if new.address is distinct from old.address then ch := ch || E'▸ Адрес: ' || coalesce(old.address, nz) || ' → ' || coalesce(new.address, nz) || E'\n'; end if;
  if new.notes is distinct from old.notes then ch := ch || E'▸ Заметка: ' || coalesce(old.notes, nz) || ' → ' || coalesce(new.notes, nz) || E'\n'; end if;
  if ch <> '' then perform rsvp_notify_match(new.id, 'update', rtrim(ch, E'\n')); end if;
  return null;
end $$;
create trigger matches_rsvp_details_notify after update of opponent, venue, address, notes, starts_at on matches
  for each row when (new.lifecycle_status = 'published' and old.lifecycle_status = 'published' and old.rescheduled_count = new.rescheduled_count)
  execute function rsvp_matches_details_notify();

revoke execute on function rsvp_notify_parent(uuid, uuid, text, uuid[], text), rsvp_notify_match(uuid, text, text), rsvp_notify_players(uuid, text, uuid[]),
  rsvp_invitations_stage(), rsvp_notice_flush(), rsvp_matches_details_notify() from public, anon, authenticated;
