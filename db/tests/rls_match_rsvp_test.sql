-- pgTAP: подтверждение участия в матчах (миграция 0134, Issue #274, PR 1): схема, жизненный цикл, RLS, права, серверные проверки.
begin;
create extension if not exists pgtap;
select plan(164);

-- ---------- данные ----------
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7002, 'Тренер А', false),
  ('00000000-0000-0000-0000-0000000000c2', 7003, 'Тренер Б', false),
  ('00000000-0000-0000-0000-0000000000b1', 7004, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7005, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 7006, 'Родитель 3', false),
  ('00000000-0000-0000-0000-0000000000b4', 7007, 'Родитель с отозванным согласием', false),
  ('00000000-0000-0000-0000-0000000000b5', 7008, 'Родитель клуба Б', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'U9');
-- тренер А ведёт только U9 клуба А, но по правилам клуба управляет матчами всех групп клуба; тренер Б — клуб Б
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Сидоров Иван', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Петров Олег', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ушедший Игрок', 'inactive'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Иванов Павел', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000e9', 'Чужой Клуб', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 't', now(), null),   -- второй родитель того же ребёнка
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),   -- у родителя 1 два ребёнка
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b3', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b4', 't', now(), now()),  -- согласие отозвано
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-0000000000b5', 't', now(), null);
-- старый (legacy) матч с фактическими отметками, взносом и баллами: после любых действий RSVP остаётся прежним
insert into rules (id, club_id, code, points, explanation, active_from)
  values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие в матче', '2026-01-01');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Старый соперник');
insert into match_players (match_id, player_id, played, goals) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000d001', true, 1);
insert into match_fees (match_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000d001', 10);
insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f9', 1, 'match', '00000000-0000-0000-0000-0000000000f0', '2026-10-10', 'Участие в матче');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
grant execute on function as_user(uuid), mid(text) to authenticated, anon;
-- контрольная сумма существующей модели участия: match_players, match_fees, point_events
create or replace function legacy_digest() returns text language sql stable as $$
  select md5(coalesce((select string_agg(t::text, '|' order by t::text) from match_players t), '') || '#' ||
             coalesce((select string_agg(t::text, '|' order by t::text) from match_fees t), '') || '#' ||
             coalesce((select string_agg(t::text, '|' order by t::text) from point_events t), ''))
$$;
create temp table digest0 as select legacy_digest() as d;

-- ---------- legacy: старые матчи не получают RSVP ----------
select is((select lifecycle_status from matches where id = '00000000-0000-0000-0000-0000000000f0'), 'legacy', 'существующий матч получил статус legacy');
select is((select count(*)::int from match_invitations), 0, 'приглашения автоматически не созданы');
select throws_ok($$insert into match_invitations (match_id, club_id, player_id) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001')$$,
  '55000', 'legacy match has no invitations', 'на legacy матч приглашение не создать даже вставкой напрямую');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_publish('00000000-0000-0000-0000-0000000000f0')$$, '55000', 'legacy match', 'legacy матч нельзя опубликовать');
select throws_ok($$select match_rsvp_invite('00000000-0000-0000-0000-0000000000f0', array['00000000-0000-0000-0000-00000000d001']::uuid[])$$, '55000', 'legacy match', 'в legacy матч нельзя добавить приглашение через функцию');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f0'), 1, 'родитель видит legacy матч своей команды, как раньше');
reset role;

-- ---------- создание черновика и права ----------
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U9', 'Динамо', now() + interval '7 days', 'Стадион', 'Адрес', null)$$, '42501', 'forbidden', 'родитель не создаёт матч');
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U9', 'Динамо', now() + interval '7 days', 'Стадион', 'Адрес', null)$$, '42501', 'forbidden', 'тренер другого клуба не создаёт матч в чужом клубе');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'other', 'U9', 'Динамо', now() + interval '7 days', null, null, null)$$, '22023', 'bad kind', 'неверный тип матча отклоняется');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', null, 'U9', 'Динамо', now() + interval '7 days', null, null, null)$$, '22023', 'bad kind', 'пустой тип матча отклоняется');
-- тренер U9 создаёт матч команды U11 (тренеры управляют матчами всех групп своего клуба)
select lives_ok($$insert into ids select 'm', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U11', 'Динамо',
  (date_trunc('day', now() at time zone 'Asia/Tbilisi') + interval '7 days 12 hours') at time zone 'Asia/Tbilisi', 'Стадион', 'ул. Тестовая 1', 'Форма синяя')$$,
  'тренер создаёт черновик матча любой группы своего клуба');
select is((select lifecycle_status from matches where id = mid('m')), 'draft', 'новый матч — черновик');
select is((select rsvp_deadline_at from matches where id = mid('m')), (select starts_at - interval '24 hours' from matches where id = mid('m')), 'дедлайн — за 24 часа до начала (Asia/Tbilisi)');
select is((select played_on from matches where id = mid('m')), (select (starts_at at time zone 'Asia/Tbilisi')::date from matches where id = mid('m')), 'played_on согласован с датой по Тбилиси');
select throws_ok($$select match_rsvp_publish(mid('m'))$$, '22023', 'no invited players', 'пустой черновик не публикуется');

-- ---------- состав черновика ----------
select is((select match_rsvp_seed(mid('m'), '00000000-0000-0000-0000-0000000000e1')), 3, 'состав группы: только активные игроки (3 из 4)');
select is((select match_rsvp_seed(mid('m'), '00000000-0000-0000-0000-0000000000e1')), 0, 'повторный снимок не дублирует');
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d005']::uuid[])$$, 'игрок другой группы клуба добавляется');
select throws_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d009']::uuid[])$$, '42501', 'player is not of this club', 'игрок другого клуба не добавляется');
select is((select count(*)::int from match_invitations where match_id = mid('m')), 4, 'неудачная операция ничего не добавила');
select throws_ok($$select match_rsvp_seed(mid('m'), '00000000-0000-0000-0000-0000000000e9')$$, '42501', 'group is not of this club', 'группа чужого клуба не используется');
select throws_ok($$select match_rsvp_update(mid('m'), '{"foo": 1}'::jsonb)$$, '22023', 'unknown field foo', 'неизвестное поле отклоняется');
select lives_ok($$select match_rsvp_update(mid('m'), '{"opponent": "Торпедо"}'::jsonb)$$, 'черновик правится');
select is((select opponent from matches where id = mid('m')), 'Торпедо', 'соперник изменён');
select is((select count(*)::int from match_activity where match_id = mid('m') and action = 'details_changed'), 0, 'правки черновика в журнал изменений не пишутся');

-- ---------- черновик не виден родителям и чужому клубу ----------
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from matches where id = mid('m')), 0, 'родитель не видит черновик');
select is((select count(*)::int from match_invitations where match_id = mid('m')), 0, 'родитель не видит приглашения черновика');
select throws_ok($$select match_rsvp_publish(mid('m'))$$, '42501', 'forbidden', 'родитель не публикует');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '42501', 'forbidden', 'ответ на черновик невозможен');
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from matches where id = mid('m')), 0, 'тренер другого клуба не видит матч (черновик)');
select throws_ok($$select match_rsvp_publish(mid('m'))$$, '42501', 'forbidden', 'тренер другого клуба не публикует');
select throws_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d009']::uuid[])$$, '42501', 'forbidden', 'тренер другого клуба не меняет состав');
select throws_ok($$select match_rsvp_summary(mid('m'))$$, '42501', 'forbidden', 'тренер другого клуба не читает сводку');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from matches where id = mid('m')), 1, 'администратор видит черновик');
reset role;
select throws_ok($$insert into match_invitations (match_id, club_id, player_id) values (mid('m'), '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d009')$$,
  '23503', null, 'на уровне БД игрок другого клуба в матч не попадает (составной внешний ключ)');

-- удаление черновика
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'tmp', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', null, now() + interval '3 days', null, null, null)$$, 'ещё один черновик');
select lives_ok($$select match_rsvp_delete_draft(mid('tmp'))$$, 'черновик удаляется окончательно');
reset role;
select is((select count(*)::int from matches where id = mid('tmp')), 0, 'удалённого черновика нет');
select is((select count(*)::int from audit_log where action = 'delete_match_draft' and entity_id = mid('tmp')), 1, 'удаление черновика записано в audit_log');

-- ---------- публикация ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_publish(mid('m'))$$, 'публикация');
select is((select lifecycle_status from matches where id = mid('m')), 'published', 'матч опубликован');
select is((select count(*)::int from match_invitations where match_id = mid('m') and answer_until = (select rsvp_deadline_at from matches where id = mid('m'))), 4, 'у всех приглашённых окно ответа до дедлайна');
select throws_ok($$select match_rsvp_publish(mid('m'))$$, '55000', 'only draft can be published', 'повторная публикация отклоняется');
select throws_ok($$select match_rsvp_delete_draft(mid('m'))$$, '55000', 'only draft can be deleted', 'опубликованный матч удалить нельзя');
reset role;
select throws_ok($$delete from matches where id = mid('m')$$, '55000', 'published match cannot be deleted', 'и прямым удалением (триггер)');
select throws_ok($$update matches set lifecycle_status = 'draft' where id = mid('m')$$, '55000', null, 'опубликованный не возвращается в черновик');
select throws_ok($$update matches set lifecycle_status = 'published' where id = '00000000-0000-0000-0000-0000000000f0'$$, '55000', null, 'legacy не становится опубликованным');

-- ---------- родители: видимость и общий ответ ----------
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from matches where id = mid('m')), 1, 'родитель видит опубликованный матч приглашённого ребёнка (команда U11, ребёнок из U9)');
select is((select array_agg(player_id order by player_id)::text from match_invitations where match_id = mid('m')),
  '{00000000-0000-0000-0000-00000000d001,00000000-0000-0000-0000-00000000d005}', 'родитель 1 видит приглашения только своих двух детей');
select is((select count(*)::int from match_invitations where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'приглашение чужого ребёнка не читается');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d002', 'yes')$$, '42501', 'forbidden', 'ответ за чужого ребёнка отклоняется');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'maybe')$$, '22023', 'bad response', 'ответ «может быть» не существует');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', null)$$, '22023', 'bad response', 'пустой ответ отклоняется (не-ответ — это отсутствие ответа)');
select lives_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, 'родитель 1 отвечает «Будет»');
select throws_ok($$select match_rsvp_summary(mid('m'))$$, '42501', 'forbidden', 'родитель не видит статистику');
select throws_ok($$select * from match_rsvp_roster(mid('m'))$$, '42501', 'forbidden', 'родитель не видит список игроков');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select response || ':' || responded_by_name from match_rsvp_my_matches() where player_id = '00000000-0000-0000-0000-00000000d001'), 'yes:Родитель 1', 'второй родитель видит общий ответ и автора');
select is((select count(*)::int from match_rsvp_my_matches()), 1, 'у второго родителя только один ребёнок в списке');
select lives_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'no')$$, 'второй родитель меняет общий ответ');
select is((select response || ':' || (responded_by = '00000000-0000-0000-0000-0000000000b2')::text from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d001'), 'no:true', 'ответ один, автор — последний изменивший');
select is((select count(*)::int from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'на ребёнка одно приглашение');
select as_user('00000000-0000-0000-0000-0000000000b1');
-- несколько детей: независимые ответы одной операцией; ошибка откатывает всё
select throws_ok($$select match_rsvp_answer_many(mid('m'), '[{"player_id":"00000000-0000-0000-0000-00000000d005","response":"yes"},{"player_id":"00000000-0000-0000-0000-00000000d002","response":"yes"}]'::jsonb)$$,
  '42501', 'forbidden', 'пакет с чужим ребёнком отклоняется целиком');
select is((select response from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d005'), null, 'после отказа пакета ответ не сохранился');
select lives_ok($$select match_rsvp_answer_many(mid('m'), '[{"player_id":"00000000-0000-0000-0000-00000000d005","response":"yes"},{"player_id":"00000000-0000-0000-0000-00000000d001","response":"yes"}]'::jsonb)$$, 'ответ за двух детей сразу');
select is((select string_agg(player_id::text || '=' || response, ',' order by player_id) from match_invitations where match_id = mid('m') and response is not null),
  '00000000-0000-0000-0000-00000000d001=yes,00000000-0000-0000-0000-00000000d005=yes', 'ответы детей независимы');
-- отозванное согласие
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from match_invitations where match_id = mid('m')), 0, 'родитель с отозванным согласием не видит приглашений');
select is((select count(*)::int from matches where id = mid('m')), 0, 'и матч не видит');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d003', 'yes')$$, '42501', 'forbidden', 'и не отвечает');
select is((select count(*)::int from match_rsvp_my_matches()), 0, 'список «мои матчи» пуст');
-- чужой клуб и посторонние
select as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from match_invitations), 0, 'родитель другого клуба не видит приглашений');
select is((select count(*)::int from matches where id = mid('m')), 0, 'и матч');
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from matches where club_id = '00000000-0000-0000-0000-00000000c001'), 0, 'тренер другого клуба не видит ни одного матча клуба А');
select is((select count(*)::int from match_invitations) + (select count(*)::int from match_activity) + (select count(*)::int from match_reminder_log), 0, 'и приглашения, журнал, напоминания клуба А');
select throws_ok($$select match_rsvp_coach_set(mid('m'), '00000000-0000-0000-0000-00000000d002', 'yes')$$, '42501', 'forbidden', 'тренер другого клуба не ставит ответ');
select throws_ok($$select match_rsvp_cancel(mid('m'))$$, '42501', 'forbidden', 'тренер другого клуба не отменяет');
reset role;

-- ---------- тренер: ответ вручную, состав после публикации ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select unanswered from match_rsvp_summary(mid('m'))), 2, 'сводка: не ответили двое (d002 и d003)');
select is((select yes::text || '/' || no::text from match_rsvp_summary(mid('m'))), '2/0', 'сводка: Будет 2, Не будет 0');
select is((select count(*)::int from match_rsvp_roster(mid('m'))), 4, 'список тренера: 4 игрока');
select lives_ok($$select match_rsvp_coach_set(mid('m'), '00000000-0000-0000-0000-00000000d002', 'no')$$, 'тренер ставит ответ вручную');
select is((select responded_by_coach from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d002'), true, 'ответ помечен как выставленный тренером');
select is((select (payload->>'after_deadline')::boolean from match_activity where match_id = mid('m') and action = 'coach_response'), false, 'до дедлайна — без пометки «после дедлайна»');
select throws_ok($$select match_rsvp_coach_set(mid('m'), '00000000-0000-0000-0000-00000000d004', 'yes')$$, 'P0002', 'player is not invited', 'нельзя ответить за неприглашённого');
-- добавление после публикации: до дедлайна окно — до дедлайна
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d004']::uuid[])$$, 'игрок добавлен после публикации');
select is((select response from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d004'), null, 'новый игрок: «Не ответил»');
-- исключение и повторное приглашение
select is((select match_rsvp_remove(mid('m'), array['00000000-0000-0000-0000-00000000d005']::uuid[])), 1, 'игрок исключён');
select is((select (payload->'removed'->0->>'response') from match_activity where match_id = mid('m') and action = 'players_removed'), 'yes', 'ответ исключённого сохранён в журнале');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d005', 'no')$$, '42501', 'forbidden', 'исключённому ответить нельзя');
select is((select count(*)::int from match_invitations where player_id = '00000000-0000-0000-0000-00000000d005'), 0, 'приглашение исключённого родителю не видно');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d005']::uuid[])), 1, 'повторное приглашение');
select is((select coalesce(response, '-') || ':' || reinvite_count::text from match_invitations where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d005'), '-:1', 'повторно приглашённый: ответ сброшен, счётчик 1');
select is((select payload->'readded'->0->>'previous_response' from match_activity where match_id = mid('m') and action = 'players_invited' order by id desc limit 1), 'yes', 'прежний ответ в журнале');

-- ---------- напоминания и единый лимит 24 часа ----------
select is((select queued::text || '/' || skipped::text from match_rsvp_remind_unanswered(mid('m'))), '1/0', 'напоминание: только родителям не ответивших (без отозванных согласий и без родителей)');
select is((select queued::text || '/' || skipped::text from match_rsvp_remind_unanswered(mid('m'))), '0/1', 'повторное ручное напоминание тому же родителю в течение 24 часов пропускается');
select is((select reminders from match_rsvp_summary(mid('m'))), 1, 'сводка: одно ручное напоминание');
select ok((select last_reminder_at is not null from match_rsvp_summary(mid('m'))), 'сводка: время последнего напоминания');
reset role;
select is((select rsvp_claim_reminder(mid('m'), '00000000-0000-0000-0000-0000000000b1', 'auto_24h')), false, 'автонапоминание не обходит лимит из-за недавнего ручного');
select is((select count(*)::int from match_reminder_log where match_id = mid('m')), 1, 'в журнале напоминаний одна запись');

-- ---------- изменения опубликованного матча ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('m'), (select jsonb_build_object('starts_at', starts_at + interval '1 hour', 'venue', 'Новый стадион') from matches where id = mid('m')))$$, 'изменение времени в тот же день');
select is((select count(*)::int from match_invitations where match_id = mid('m') and response is not null), 2, 'ответы при смене времени сохранены');
select is((select count(*)::int from match_invitations i, matches m2 where m2.id = i.match_id and i.match_id = mid('m') and i.status = 'invited' and i.answer_until = m2.rsvp_deadline_at), 5, 'окно ответа пересчитано по новому дедлайну');
select is((select (payload->'after'->>'venue') from match_activity where match_id = mid('m') and action = 'details_changed'), 'Новый стадион', 'изменение места записано в журнал');
select throws_ok($$select match_rsvp_update(mid('m'), (select jsonb_build_object('starts_at', starts_at + interval '1 day') from matches where id = mid('m')))$$, '55000', 'date change requires reschedule', 'смена даты — только переносом');
select throws_ok($$select match_rsvp_update(mid('m'), '{"kind": "friendly"}'::jsonb)$$, '55000', 'field is fixed after publish', 'тип и команда после публикации не меняются');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_reschedule(mid('m'), now() + interval '9 days')$$, '42501', 'forbidden', 'родитель не переносит матч');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_reschedule(mid('m'), now() - interval '1 hour')$$, '22023', 'start in the past', 'перенос в прошлое отклоняется');
select throws_ok($$select match_rsvp_cancel(mid('tmp'))$$, '42501', 'forbidden', 'удалённый черновик не найти (отмена невозможна)');

-- ---------- единый лимит: автонапоминание первым, ручное вторым; дубли cron ----------
select lives_ok($$insert into ids select 'm6', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Спартак', now() + interval '5 hours', null, null, null)$$, 'матч, который начнётся через 5 часов');
select lives_ok($$select match_rsvp_invite(mid('m6'), array['00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d001']::uuid[])$$, 'состав матча 6');
select lives_ok($$select match_rsvp_publish(mid('m6'))$$, 'опубликован менее чем за 24 часа до начала');
select is((select count(*)::int from match_invitations where match_id = mid('m6') and answer_until = (select starts_at from matches where id = mid('m6'))), 2, 'поздняя публикация: ответить можно до начала матча');
reset role;
select is((select rsvp_claim_reminder(mid('m6'), '00000000-0000-0000-0000-0000000000b3', 'auto_24h')), true, 'автонапоминание поставлено');
select is((select rsvp_claim_reminder(mid('m6'), '00000000-0000-0000-0000-0000000000b3', 'auto_24h')), false, 'повтор автонапоминания не создаёт дубль');
select is((select rsvp_claim_reminder(mid('m6'), '00000000-0000-0000-0000-0000000000b3', 'auto_48h')), false, 'другое автонапоминание в течение 24 часов тоже не ставится');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select queued::text || '/' || skipped::text from match_rsvp_remind_unanswered(mid('m6'))), '2/1', 'ручное напоминание: родитель 3 пропущен из-за недавнего автоматического, оба родителя d001 получили');
select is((select count(*)::int from match_activity where match_id = mid('m6') and action = 'manual_reminder'), 1, 'ручное напоминание записано в журнал (число)');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select match_rsvp_answer(mid('m6'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, 'поздний ответ до начала матча принимается');
reset role;
-- фактические отметки на матче 6 (существующая модель) — их RSVP менять не должен
insert into match_players (match_id, player_id, played, goals) values (mid('m6'), '00000000-0000-0000-0000-00000000d001', true, 2);
create temp table digest1 as select legacy_digest() as d;

-- ---------- перенос основного матча ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_reschedule(mid('m'), (date_trunc('day', now() at time zone 'Asia/Tbilisi') + interval '9 days 12 hours') at time zone 'Asia/Tbilisi', null, 'ул. Новая 5')$$, 'перенос на другую дату');
select is((select count(*)::int from match_invitations where match_id = mid('m') and status = 'invited' and response is not null), 0, 'все ответы сброшены на «Не ответил»');
select is((select count(*)::int from match_invitations where match_id = mid('m') and status = 'invited'), 5, 'список приглашённых сохранён');
select is((select count(*)::int from matches where opponent = 'Торпедо'), 1, 'перенос не создаёт дубликат матча');
select is((select rescheduled_count::text || ':' || address from matches where id = mid('m')), '1:ул. Новая 5', 'счётчик переносов и новый адрес');
select ok((select jsonb_array_length(payload->'reset_responses') > 0 and (payload->>'fact_marks_present')::boolean = false from match_activity where match_id = mid('m') and action = 'rescheduled'), 'в журнале прежние ответы и дата');
select is((select count(*)::int from match_invitations i, matches m2 where m2.id = i.match_id and i.match_id = mid('m') and i.answer_until = m2.rsvp_deadline_at and i.status = 'invited'), 5, 'дедлайн пересчитан от новой даты');
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, 'после переноса родитель отвечает заново');
select is((select rescheduled from match_rsvp_my_matches() where match_id = mid('m')), true, 'родителю виден признак «Перенесён»');

-- ---------- закрытие ответов: дедлайн, начало матча ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'm4', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U9', 'Локомотив', now() + interval '30 hours', null, null, null)$$, 'матч через 30 часов');
select lives_ok($$select match_rsvp_invite(mid('m4'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'состав матча 4');
select lives_ok($$select match_rsvp_publish(mid('m4'))$$, 'публикация матча 4');
reset role;
-- имитация прошедшего дедлайна (до начала ещё 30 часов): окно ответа закрыто
update match_invitations set answer_until = clock_timestamp() - interval '1 minute' where match_id = mid('m4');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_answer(mid('m4'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '55000', 'answers are closed', 'после дедлайна родитель ответ не меняет (прямой вызов функции)');
select is((select can_answer from match_rsvp_my_matches() where match_id = mid('m4')), false, 'и экран получает can_answer = false');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_coach_set(mid('m4'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, 'тренер после дедлайна ответ ставит');
select is((select (payload->>'after_deadline')::boolean from match_activity where match_id = mid('m4') and action = 'coach_response'), true, 'и это зафиксировано с автором и пометкой «после дедлайна»');
select is((select actor_id from match_activity where match_id = mid('m4') and action = 'coach_response'), '00000000-0000-0000-0000-0000000000c1'::uuid, 'автор записан');
reset role;
update matches set starts_at = clock_timestamp() + interval '10 hours' where id = mid('m4');  -- имитация: дедлайн прошёл по-настоящему (до начала 10 часов)
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_invite(mid('m4'), array['00000000-0000-0000-0000-00000000d005']::uuid[])$$, 'после дедлайна игрока добавить можно');
select is((select answer_until = (select starts_at from matches where id = mid('m4')) from match_invitations where match_id = mid('m4') and player_id = '00000000-0000-0000-0000-00000000d005'), true, 'добавленному после дедлайна — отвечать до начала матча');
reset role;
-- имитация начала матча 6
update matches set starts_at = clock_timestamp() - interval '1 minute' where id = mid('m6');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_answer(mid('m6'), '00000000-0000-0000-0000-00000000d001', 'no')$$, '55000', 'answers are closed', 'после начала матча ответы закрыты');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_coach_set(mid('m6'), '00000000-0000-0000-0000-00000000d001', 'no')$$, '55000', 'match already started', 'тренер после начала ответ не меняет');
select throws_ok($$select match_rsvp_invite(mid('m6'), array['00000000-0000-0000-0000-00000000d003']::uuid[])$$, '55000', 'match already started', 'после начала состав закрыт (добавление)');
select throws_ok($$select match_rsvp_remove(mid('m6'), array['00000000-0000-0000-0000-00000000d001']::uuid[])$$, '55000', 'match already started', 'после начала состав закрыт (исключение)');
select throws_ok($$select match_rsvp_update(mid('m6'), '{"notes": "x"}'::jsonb)$$, '55000', 'match already started', 'после начала параметры закрыты');
select throws_ok($$select match_rsvp_remind_unanswered(mid('m6'))$$, '55000', 'match already started', 'после начала напоминаний нет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from match_rsvp_my_matches() where match_id = mid('m6') and can_answer), 0, 'начавшийся матч в списке родителя без возможности ответить');
-- перенос возможен и после начала
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_reschedule(mid('m6'), now() + interval '3 days')$$, 'перенос возможен после начала матча');
select ok((select (payload->>'fact_marks_present')::boolean and (payload->>'was_started')::boolean from match_activity where match_id = mid('m6') and action = 'rescheduled'), 'в журнале: матч уже начался, фактические отметки были');
reset role;
select is(legacy_digest(), (select d from digest1), 'фактические отметки, взносы и баллы после переноса не изменились');

-- ---------- отмена ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_cancel(mid('m'), 'Дождь')$$, 'отмена опубликованного матча');
select is((select lifecycle_status from matches where id = mid('m')), 'cancelled', 'матч отменён');
select throws_ok($$select match_rsvp_cancel(mid('m'))$$, '55000', 'match is already cancelled', 'повторная отмена отклоняется');
select throws_ok($$select match_rsvp_update(mid('m'), '{"notes": "x"}'::jsonb)$$, '55000', 'match is cancelled', 'отменённый матч не правится');
select throws_ok($$select match_rsvp_reschedule(mid('m'), now() + interval '20 days')$$, '55000', 'only published match can be rescheduled', 'отменённый матч не переносится');
select throws_ok($$select match_rsvp_coach_set(mid('m'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '55000', 'match is not published', 'после отмены ответы тренером не ставятся');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '55000', 'match is cancelled', 'после отмены родитель не отвечает');
select is((select count(*)::int from match_rsvp_my_matches() where match_id = mid('m') and lifecycle_status = 'cancelled' and not can_answer), 2, 'родитель видит отменённый матч (оба своих приглашённых ребёнка)') ;
reset role;
select throws_ok($$update matches set lifecycle_status = 'published' where id = mid('m')$$, '55000', null, 'отменённый матч не восстановить');
select is((select count(*)::int from match_invitations where match_id = mid('m')), 5, 'список приглашённых сохранён после отмены');
select is(legacy_digest(), (select d from digest1), 'отмена не меняет существующие отметки, взносы и баллы');

-- ---------- RLS журнала и напоминаний ----------
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from match_activity) + (select count(*)::int from match_reminder_log), 0, 'родитель не читает журнал и напоминания');
reset role;

-- ---------- права на таблицы и функции ----------
select is((select count(*)::int from (values ('match_invitations'), ('match_activity'), ('match_reminder_log')) t(n)
            where has_table_privilege('authenticated', 'public.' || n, 'insert') or has_table_privilege('authenticated', 'public.' || n, 'update')
               or has_table_privilege('authenticated', 'public.' || n, 'delete') or has_table_privilege('anon', 'public.' || n, 'select')), 0,
  'новые таблицы: клиенты только читают (под RLS), гость ничего');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'match_rsvp\_%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'гостю функции match_rsvp_* недоступны');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rsvp_assert_staff', 'rsvp_lock_match', 'rsvp_log', 'rsvp_claim_reminder')
            and has_function_privilege('authenticated', p.oid, 'execute')), 0, 'служебные функции RSVP закрыты от приложения');
select ok(has_function_privilege('service_role', 'rsvp_claim_reminder(uuid, uuid, text, uuid)', 'execute'), 'постановка напоминания доступна служебной роли (cron в PR 2)');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into match_invitations (match_id, club_id, player_id) values (mid('m'), '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d003')$$, '42501', null, 'прямая запись приглашения закрыта даже для тренера');
select throws_ok($$update match_invitations set response = 'yes' where match_id = mid('m')$$, '42501', null, 'прямое изменение ответа закрыто');
select throws_ok($$select rsvp_claim_reminder(mid('m'), '00000000-0000-0000-0000-0000000000b3', 'auto_24h')$$, '42501', null, 'тренер не вызывает постановку автонапоминания напрямую');
reset role;

select * from finish();
rollback;
