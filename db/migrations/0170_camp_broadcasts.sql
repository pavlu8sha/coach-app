-- 0170 (Issue #470, этап 6): ручные рассылки по сбору. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (39-42, 42а).
-- Два вида:
--  * info: информационная. Получатели: родители активных игроков клуба с действующим согласием и включёнными уведомлениями
--    (решение Q9: гости получают только решения по заявкам и документы). Текст одинаков для всех.
--  * reminder: напоминание об оплате. Получатели: семьи записанных участников с положительным остатком (сумма записи минус
--    внесённое; частичная оплата не исключает): родители игрока с действующим согласием и владелец гостевой записи.
--    В сообщении только свои дети этого получателя, их остатки и срок полной оплаты.
-- Одно сообщение на человека. Предпросмотр (camp_broadcast_preview) и отправка (camp_broadcast_send) считают получателей
-- одной функцией camp_broadcast_targets; отправка требует число получателей, показанное администратору, и отказывает,
-- если оно изменилось. Расписаний нет: отправку вызывает только администратор из приложения.
-- Пока клубная настройка camps.notify не равна «on», отправка отклоняется (включает владелец, db/ops/camps_notify_enable.sql).
-- Журнал camp_broadcasts не удаляется и не правится; итог отправки считается по очереди notifications
-- (сообщения старше 30 дней очередь очищает, их число журнал показывает как «очищено»).
-- Ограничения: у одного человека не больше трёх сообщений рассылок за сутки (такие люди в получателей не попадают и в
-- предпросмотре не считаются); массовые сообщения в очереди идут после обычных уведомлений.

create table if not exists camp_broadcasts (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id) on delete restrict,
  kind text not null check (kind in ('info', 'reminder')),
  body text,
  recipients int not null check (recipients >= 1),
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists camp_broadcasts_camp_idx on camp_broadcasts (camp_id, created_at);

create table if not exists camp_broadcast_messages (
  broadcast_id uuid not null references camp_broadcasts(id) on delete restrict,
  notification_id uuid not null,
  user_id uuid not null,
  primary key (broadcast_id, notification_id)
);

alter table camp_broadcasts enable row level security;
alter table camp_broadcast_messages enable row level security;
revoke all on camp_broadcasts, camp_broadcast_messages from public, anon, authenticated, service_role;
grant select on camp_broadcasts, camp_broadcast_messages to service_role;

create or replace function camp_broadcasts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'immutable' using errcode = 'P0001';
end $$;
drop trigger if exists camp_broadcasts_immutable on camp_broadcasts;
create trigger camp_broadcasts_immutable before update or delete on camp_broadcasts for each row execute function camp_broadcasts_guard();
drop trigger if exists camp_broadcasts_no_truncate on camp_broadcasts;
create trigger camp_broadcasts_no_truncate before truncate on camp_broadcasts for each statement execute function camp_broadcasts_guard();
drop trigger if exists camp_broadcast_messages_immutable on camp_broadcast_messages;
create trigger camp_broadcast_messages_immutable before update or delete on camp_broadcast_messages for each row execute function camp_broadcasts_guard();
drop trigger if exists camp_broadcast_messages_no_truncate on camp_broadcast_messages;
create trigger camp_broadcast_messages_no_truncate before truncate on camp_broadcast_messages for each statement execute function camp_broadcasts_guard();

-- Текст администратора: без управляющих и невидимых символов (переносы строк сохраняются), не длиннее 1000 знаков
create or replace function camp_broadcast_clean(t text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(t, ''), E'\r\n?', E'\n', 'g'),
                                     '[\u0000-\u0009\u000b-\u001f\u007f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', '', 'g'),
                      E' \t\n'), '')
$$;

-- Имя ребёнка в сообщении (замена функции 0167): дополнительно убираем невидимые символы и символы направления текста
create or replace function camp_notify_name(t text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(btrim(regexp_replace(translate(regexp_replace(regexp_replace(coalesce(t, ''), '[\u0000-\u001f\u007f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', '', 'g'),
                                                        ' \(\d\d\.\d\d\.\d{4}\)$', ''), './:@\', '     '), '\s+', ' ', 'g')), ''), '—')
$$;

-- Получатели и текст каждому. Единственная функция подсчёта: её используют и предпросмотр, и отправка.
create or replace function camp_broadcast_targets(cid uuid, k text, b text) returns table (user_id uuid, msg text)
language plpgsql stable security definer set search_path = public as $$
declare c camps;
begin
  select * into c from camps where id = cid;
  if k = 'info' then
    return query
      select x.uid, 'Сбор «' || left(c.name, 200) || E'»:\n' || b
        from (select distinct g.user_id as uid
                from player_guardians g
                join players p on p.id = g.player_id and p.club_id = c.club_id and p.status = 'active'
                join users u on u.id = g.user_id and u.notifications_enabled
               where g.consent_revoked_at is null
                 and (select count(*) from notifications n where n.user_id = g.user_id and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day') < 3) x
       order by x.uid;
  else
    return query
      with debt as (
        select cp.id, cp.player_id, cp.owner_user_id,
               camp_notify_name(coalesce(pl.full_name, cp.guest_name)) as child,
               cp.amount - coalesce((select sum(pm.amount) from camp_payments pm where pm.participant_id = cp.id), 0) as rest
          from camp_participants cp left join players pl on pl.id = cp.player_id
         where cp.camp_id = cid and cp.status = 'registered'),
      fam as (
        select g.user_id as uid, d.child, d.rest from debt d join player_guardians g on g.player_id = d.player_id and g.consent_revoked_at is null where d.rest > 0
        union all
        select d.owner_user_id, d.child, d.rest from debt d where d.rest > 0 and d.owner_user_id is not null)
      select f.uid,
             'Напоминание об оплате сбора «' || left(c.name, 200) || E'».\nОсталось внести:\n'
             || string_agg(f.child || ': ' || trim(to_char(f.rest, 'FM999999990.00')) || ' ₾', E'\n' order by f.child)
             || case when c.full_payment_deadline is not null then E'\nСрок полной оплаты: ' || to_char(c.full_payment_deadline, 'DD.MM.YYYY') || '.' else '' end
             || case when b is not null then E'\n\n' || b else '' end
             || E'\nОткройте приложение, раздел «Сборы».'
        from fam f join users u on u.id = f.uid and u.notifications_enabled
       where (select count(*) from notifications n where n.user_id = f.uid and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day') < 3
       group by f.uid
       order by f.uid;
  end if;
end $$;

-- Записанные участники с долгом, до которых рассылка не дойдёт: нет родителя с согласием и включёнными уведомлениями,
-- нет владельца гостевой записи, либо лимит сообщений на человека исчерпан
create or replace function camp_broadcast_unreachable(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from camp_participants cp
   where cp.camp_id = cid and cp.status = 'registered'
     and cp.amount - coalesce((select sum(pm.amount) from camp_payments pm where pm.participant_id = cp.id), 0) > 0
     and not exists (
       select 1 from camp_broadcast_targets(cid, 'reminder', null) t
        where t.user_id = cp.owner_user_id
           or t.user_id in (select g.user_id from player_guardians g where g.player_id = cp.player_id and g.consent_revoked_at is null))
$$;

create or replace function camp_broadcast_check(cid uuid, k text, b text) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text := camp_broadcast_clean(b);
begin
  perform camp_assert_admin();
  if k is null or k not in ('info', 'reminder') then raise exception 'bad kind' using errcode = '22023'; end if;
  if (k = 'info' and t is null) or length(t) > 1000 then raise exception 'bad text' using errcode = '22023'; end if;
  perform 1 from camps where id = cid;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  return t;
end $$;

-- Предпросмотр: число получателей и пример текста. Ничего не отправляет и в журнал не пишет.
create or replace function camp_broadcast_preview(cid uuid, k text, b text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := camp_broadcast_check(cid, k, b); n int; s text; tok text;
begin
  select count(*)::int, min(x.msg) filter (where x.rn = 1), md5(coalesce(string_agg(x.user_id::text || ':' || x.msg, '|' order by x.user_id), ''))
    into n, s, tok
    from (select tg.user_id, tg.msg, row_number() over () as rn from camp_broadcast_targets(cid, k, t) tg) x;
  if s is null and k = 'info' then s := 'Сбор «' || left((select name from camps where id = cid), 200) || E'»:\n' || t; end if;
  return jsonb_build_object('recipients', n, 'sample', s, 'token', tok,
                            'unreachable', case when k = 'reminder' then camp_broadcast_unreachable(cid) end,
                            'enabled', camp_notify_enabled((select club_id from camps where id = cid)));
end $$;

-- Отправка по явному подтверждению: expected = число получателей, показанное администратору в предпросмотре.
create or replace function camp_broadcast_send(cid uuid, k text, b text, expected int, tok text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := camp_broadcast_check(cid, k, b); c camps; n int; bid uuid := gen_random_uuid(); r record; nid uuid; list jsonb; cur text;
begin
  select * into c from camps where id = cid for update;
  if not camp_notify_enabled(c.club_id) then raise exception 'notifications off' using errcode = '22023'; end if;
  if expected is null then raise exception 'confirmation required' using errcode = '22023'; end if;
  if exists (select 1 from camp_broadcasts where camp_id = cid and kind = k and body is not distinct from t and created_at > now() - interval '10 minutes') then
    raise exception 'duplicate broadcast' using errcode = '22023';
  end if;
  if (select count(*) from camp_broadcasts where camp_id = cid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many broadcasts' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('u', x.user_id, 'm', x.msg) order by x.user_id), '[]'::jsonb),
         md5(coalesce(string_agg(x.user_id::text || ':' || x.msg, '|' order by x.user_id), ''))
    into list, cur from camp_broadcast_targets(cid, k, t) x;
  n := jsonb_array_length(list);
  if n = 0 then raise exception 'no recipients' using errcode = '22023'; end if;
  -- подтверждается не только число, но и состав получателей с текстом каждому
  if n <> expected or tok is distinct from cur then raise exception 'recipients changed' using errcode = '22023'; end if;
  insert into camp_broadcasts (id, camp_id, kind, body, recipients, author_id, author_name)
  values (bid, cid, k, case when k = 'reminder' then 'Напоминание об оплате (остаток каждой семьи подставлен автоматически)' || case when t is not null then E'\n' || t else '' end else t end, n, current_user_id(), (select display_name from users where id = current_user_id()));
  for r in select (e ->> 'u')::uuid as user_id, e ->> 'm' as msg from jsonb_array_elements(list) e loop
    insert into notifications (user_id, kind, text) values (r.user_id, 'camp_broadcast_' || k, r.msg) returning id into nid;
    insert into camp_broadcast_messages (broadcast_id, notification_id, user_id) values (bid, nid, r.user_id);
  end loop;
  return jsonb_build_object('id', bid, 'recipients', n);
end $$;

-- Журнал: кто, когда, вид, текст, число получателей, итог отправки по очереди
create or replace function camp_broadcast_list(cid uuid)
returns table (id uuid, kind text, body text, recipients int, author_name text, created_at timestamptz, pending int, sent int, failed int, cleared int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  return query
    select b.id, b.kind, b.body, b.recipients, b.author_name, b.created_at,
           count(n.id) filter (where n.state = 'pending')::int,
           count(n.id) filter (where n.state = 'sent')::int,
           count(n.id) filter (where n.state = 'failed')::int,
           (b.recipients - count(n.id))::int
      from camp_broadcasts b
      left join camp_broadcast_messages m on m.broadcast_id = b.id
      left join notifications n on n.id = m.notification_id
     where b.camp_id = cid
     group by b.id
     order by b.created_at desc;
end $$;

-- Очередь: массовые сообщения рассылок идут после обычных уведомлений (решения по заявкам, документы, матчи не ждут рассылку)
create or replace function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text, buttons jsonb)
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id in (
       select x.id from notifications x
        where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by (x.kind like 'camp\_broadcast\_%'), x.created_at limit greatest(1, least(n, 50)) for update skip locked)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons;
end $$;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

revoke execute on function camp_broadcasts_guard(), camp_broadcast_clean(text), camp_broadcast_targets(uuid, text, text),
  camp_broadcast_check(uuid, text, text), camp_broadcast_unreachable(uuid), camp_broadcast_preview(uuid, text, text), camp_broadcast_send(uuid, text, text, int, text),
  camp_broadcast_list(uuid) from public, anon, authenticated, service_role;
grant execute on function camp_broadcast_preview(uuid, text, text), camp_broadcast_send(uuid, text, text, int, text), camp_broadcast_list(uuid) to authenticated;
