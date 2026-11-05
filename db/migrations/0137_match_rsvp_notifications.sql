-- Подтверждение участия в матчах, PR 2b (Issue #274): уведомления родителям с кнопками «Будет» / «Не будет» в боте,
-- автоматические напоминания (за 48 и 24 часа), ответ по нажатию кнопки. Старые уведомления и триггеры не меняются.
-- Доставляет сообщения существующая очередь notifications (0026) и функция tg-notify; расписание cron — db/ops/match_rsvp_cron.sql (владелец).

-- Кнопки сообщения: [[{"text": "...", "data": "r:<id приглашения>:y"}], ...]; null — только «Открыть приложение»
alter table notifications add column buttons jsonb;

-- Отправитель теперь получает и кнопки (меняется тип результата, поэтому функцию пересоздаём)
drop function claim_notifications(int);
create function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text, buttons jsonb)
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id in (
       select x.id from notifications x
        where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by x.created_at limit greatest(1, least(n, 50)) for update skip locked)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons;
end $$;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

-- Время матча для сообщений: по Тбилиси
create or replace function rsvp_when(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'Asia/Tbilisi', 'DD.MM.YYYY HH24:MI') $$;

-- Сообщение одному родителю о матче. k: invite, reschedule, reminder, cancel. Перечисляет только его детей, приглашённых на матч
-- (для reminder — только не ответивших). Кнопки ответа — по одной паре на ребёнка (кроме отмены). only_player — только за этого ребёнка.
create or replace function rsvp_notify_parent(m uuid, u uuid, k text, only_player uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; r record; names text := ''; btn jsonb := '[]'::jsonb; head text; body text; first_name text;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status not in ('published', 'cancelled') then return; end if;
  for r in
    select i.id as inv, p.full_name
      from match_invitations i
      join players p on p.id = i.player_id
      join player_guardians g on g.player_id = i.player_id and g.user_id = u and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' and (only_player is null or i.player_id = only_player)
       and (k <> 'reminder' or i.response is null)
     order by p.full_name
  loop
    names := names || case when names = '' then '' else ', ' end || r.full_name;
    if k <> 'cancel' and mt.lifecycle_status = 'published' then
      first_name := coalesce(nullif(split_part(r.full_name, ' ', 2), ''), r.full_name);
      btn := btn || jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text', first_name || ': Будет', 'data', 'r:' || r.inv || ':y'),
        jsonb_build_object('text', first_name || ': Не будет', 'data', 'r:' || r.inv || ':n')));
    end if;
  end loop;
  if names = '' then return; end if;
  head := case k when 'invite' then '⚽ Приглашение на матч' when 'reschedule' then '📅 Матч перенесён' when 'cancel' then '❌ Матч отменён' else '⏰ Напоминание о матче' end;
  body := head || E'\n' || mt.team || ' · ' || coalesce(mt.opponent, 'соперник уточняется')
       || E'\n' || rsvp_when(mt.starts_at)
       || coalesce(E'\n' || nullif(concat_ws(', ', mt.venue, mt.address), ''), '')
       || coalesce(E'\n' || mt.notes, '')
       || E'\nИгрок: ' || names;
  if k = 'cancel' then
    body := body || coalesce(E'\nПричина: ' || nullif(mt.cancel_reason, ''), '');
  else
    body := body || case k when 'reschedule' then E'\nПрежние ответы сброшены, ответьте заново' when 'reminder' then E'\nВы ещё не ответили' else E'\nПожалуйста, ответьте' end
         || ' до ' || rsvp_when(match_rsvp_answer_until(mt.starts_at)) || '.';
  end if;
  if exists (select 1 from users where id = u and notifications_enabled) then
    insert into notifications (user_id, kind, text, buttons) values (u, 'rsvp_' || k, body, nullif(btn, '[]'::jsonb));
  end if;
end $$;

-- Всем родителям приглашённых детей (каждому одно сообщение со всеми его детьми)
create or replace function rsvp_notify_match(m uuid, k text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in
    select distinct g.user_id from match_invitations i
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' order by g.user_id
  loop
    perform rsvp_notify_parent(m, u, k);
  end loop;
end $$;

-- События матча: публикация, отмена, перенос
create or replace function rsvp_matches_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'published' then
    perform rsvp_notify_match(new.id, 'invite');
  elsif old.lifecycle_status = 'published' and new.lifecycle_status = 'cancelled' then
    perform rsvp_notify_match(new.id, 'cancel');
  elsif new.lifecycle_status = 'published' and new.rescheduled_count > old.rescheduled_count then
    perform rsvp_notify_match(new.id, 'reschedule');
  end if;
  return null;
end $$;
create trigger matches_rsvp_notify after update of lifecycle_status, rescheduled_count on matches
  for each row when (old.lifecycle_status is distinct from new.lifecycle_status or old.rescheduled_count is distinct from new.rescheduled_count)
  execute function rsvp_matches_notify();

-- Игрока пригласили в уже опубликованный матч (или вернули в список): сообщение его родителям
create or replace function rsvp_invitation_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.status = 'invited' and (tg_op = 'INSERT' or old.status = 'removed')
     and exists (select 1 from matches mt where mt.id = new.match_id and mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()) then
    for u in select g.user_id from player_guardians g where g.player_id = new.player_id and g.consent_revoked_at is null order by g.user_id loop
      perform rsvp_notify_parent(new.match_id, u, 'invite', new.player_id);
    end loop;
  end if;
  return null;
end $$;
create trigger match_invitations_notify after insert or update of status on match_invitations
  for each row execute function rsvp_invitation_notify();

-- Напоминание (ручное и автоматическое) теперь действительно ставится в очередь сообщений: после занятия слота в журнале лимита
create or replace function rsvp_claim_reminder(m uuid, u uuid, k text, actor uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status <> 'published' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  if exists (select 1 from match_reminder_log where recipient_id = u and created_at > clock_timestamp() - case when k like 'auto%' then interval '23 hours 45 minutes' else interval '24 hours' end) then
    return false;
  end if;
  insert into match_reminder_log (match_id, club_id, recipient_id, kind, schedule_version, sent_by)
    values (m, mt.club_id, u, k, mt.rescheduled_count, actor)
    on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform rsvp_notify_parent(m, u, 'reminder'); end if;
  return n > 0;
end $$;

-- Автоматические напоминания: вызывает cron под служебной ролью. Не ответившим родителям опубликованных матчей:
--  auto_48h — за 48 часов до начала и позже, auto_24h — за сутки (с допуском 15 минут к лимиту «раз в 24 часа»).
-- Не напоминаем, если приглашение или перенос были меньше 12 часов назад, приём ответов закрыт или матч начался.
-- Один родитель получает не больше одного напоминания в сутки по всем матчам: ближайший матч идёт первым.
create or replace function rsvp_auto_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; q int := 0; k text;
begin
  for r in
    select mt.id as m, g.user_id as u, mt.starts_at
      from matches mt
      join match_invitations i on i.match_id = mt.id and i.status = 'invited' and i.response is null
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()
       and clock_timestamp() >= mt.starts_at - interval '48 hours'
       and clock_timestamp() <= coalesce(i.answer_until, mt.starts_at)
       and greatest(coalesce(mt.published_at, '-infinity'), coalesce(mt.rescheduled_at, '-infinity')) < clock_timestamp() - interval '12 hours'
     group by mt.id, g.user_id, mt.starts_at
     order by mt.starts_at, g.user_id
  loop
    k := case when clock_timestamp() >= r.starts_at - interval '24 hours 15 minutes' then 'auto_24h' else 'auto_48h' end;
    if rsvp_claim_reminder(r.m, r.u, k, null) then q := q + 1; end if;
  end loop;
  return q;
end $$;

-- Ответ по нажатию кнопки в боте. Вызывает только tg-bot под служебной ролью. Родитель определяется по Telegram-аккаунту,
-- дальше действует та же проверка, что и в приложении (match_rsvp_answer): связь с согласием, срок ответа, статус матча.
create or replace function rsvp_answer_by_telegram(p_telegram_id bigint, p_invitation uuid, p_response text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; inv match_invitations; mt matches; pl text;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  select * into inv from match_invitations where id = p_invitation;
  if inv.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform match_rsvp_answer(inv.match_id, inv.player_id, p_response);
  exception when others then
    return jsonb_build_object('ok', false, 'code', case sqlstate when '55000' then 'closed' when '42501' then 'forbidden' when '22023' then 'bad_request' else 'error' end);
  end;
  select * into mt from matches where id = inv.match_id;
  select full_name into pl from players where id = inv.player_id;
  return jsonb_build_object('ok', true, 'player', pl, 'response', p_response, 'team', mt.team, 'opponent', mt.opponent);
end $$;

revoke execute on function rsvp_when(timestamptz), rsvp_notify_parent(uuid, uuid, text, uuid), rsvp_notify_match(uuid, text), rsvp_matches_notify(), rsvp_invitation_notify(),
  rsvp_auto_reminders(), rsvp_answer_by_telegram(bigint, uuid, text) from public, anon, authenticated;
grant execute on function rsvp_auto_reminders(), rsvp_answer_by_telegram(bigint, uuid, text) to service_role;
