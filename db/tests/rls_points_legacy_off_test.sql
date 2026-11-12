-- pgTAP: отключение старой системы баллов (0185, #504). Условия: docs/POINTS_LEGACY_OFF_ACCEPTANCE.md. Фикстуры вымышленные.
-- Отложенные триггеры журнала срабатывают в конце транзакции; здесь одна общая транзакция, поэтому «конец транзакции»
-- изображается парой set constraints all immediate / deferred.
begin;
create extension if not exists pgtap;
select plan(47);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 18501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 18502, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 18503, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', null, 'Вера (ушла)', 'inactive');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into rules (id, club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-00000000c001', 'coach_bonus', 1, 'Отметка тренера', date '2026-01-01'),
  ('00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие', date '2026-01-01'),
  ('00000000-0000-0000-0000-0000000001a4', '00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа', date '2026-01-01'),
  ('00000000-0000-0000-0000-0000000001a5', '00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол', date '2026-01-01'),
  ('00000000-0000-0000-0000-0000000001a6', '00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший', date '2026-01-01');
insert into points_rule_versions (club_id, effective_from, params) values ('00000000-0000-0000-0000-00000000c001', '2026-11-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'training', 'ATT|2026-11-03', 'regular');
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000c001', '2026-11-04', 'G1', 'Старый соперник', 1, 0);
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d001', true, 1);

-- архив старых баллов (как в prod до 0185): вставляется в обход заморозки
alter table point_events disable trigger point_events_archive_freeze;
insert into point_events (id, player_id, rule_id, points, source_type, source_id, occurred_on, explanation) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000001a1', 1, 'session', '00000000-0000-0000-0000-0000000005a1', '2026-11-03', 'Архив: тренировка'),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000001a4', 2, 'match', '00000000-0000-0000-0000-0000000007a1', '2026-11-04', 'Архив: победа'),
  ('00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000001a2', 3, 'coach', gen_random_uuid(), '2026-11-05', 'Архив: ручной'),
  ('00000000-0000-0000-0000-0000000008a4', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000001a1', 1, 'session', gen_random_uuid(), '2026-10-01', 'Архив: ушедшая');
alter table point_events enable trigger point_events_archive_freeze;

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function pe_count() returns int language sql as $$ select count(*)::int from point_events $$;
create or replace function n_bonus() returns int language sql as $$
  select count(*)::int from notifications where kind = 'bonus' and user_id = '00000000-0000-0000-0000-0000000000b1' $$;

-- 1. Заморозка и удалённое уведомление
select has_trigger('point_events', 'point_events_archive_freeze', 'у point_events есть триггер заморозки архива');
select hasnt_trigger('point_events', 'point_events_notify', 'старого уведомления о баллах нет');
select is(pe_count(), 4, 'архив на месте');

insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
  values ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000001a1', 1, 'session', gen_random_uuid(), '2026-11-06', 'новая');
select is(pe_count(), 4, 'прямая вставка в point_events ничего не добавляет');
update point_events set points = 100 where id = '00000000-0000-0000-0000-0000000008a1';
select is((select points from point_events where id = '00000000-0000-0000-0000-0000000008a1'), 1, 'строку архива нельзя изменить');
delete from point_events where id = '00000000-0000-0000-0000-0000000008a3';
select is(pe_count(), 4, 'прямое удаление строки архива ничего не удаляет');

-- 2. Отметки посещаемости: работают, архив не меняется, новый журнал пишется
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"absent"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"}]')$$,
  'mark_attendance работает');
reset role;
select is(pe_count(), 4, 'mark_attendance не пишет в point_events');
select ok(exists (select 1 from point_events where id = '00000000-0000-0000-0000-0000000008a1'), 'отметка «не был» не удаляет архивную строку');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 1, 'новый журнал: балл за тренировку');

-- 3. Матчи: сохранение, правка старого матча, удаление
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', tbilisi_day(now()), 'Соперник', 2, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":1,"best":true}]')$$,
  'save_match работает');
reset role;
set constraints all immediate; set constraints all deferred;
select is(pe_count(), 4, 'save_match не пишет в point_events');
select is((select points from points_ledger where source_type = 'match' and status = 'active' and event_date = tbilisi_day(now())), 5, 'новый журнал: баллы за матч');
select is(n_bonus(), 1, 'родитель получил одно уведомление о матче (новый путь)');

select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-04', 'Старый соперник', 1, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":0,"best":false}]')$$,
  'правка старого матча работает');
reset role;
select ok(exists (select 1 from point_events where id = '00000000-0000-0000-0000-0000000008a2'), 'правка матча не стирает архивные баллы матча');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select delete_match('00000000-0000-0000-0000-0000000007a1')$$, 'delete_match работает');
reset role;
select ok(exists (select 1 from point_events where id = '00000000-0000-0000-0000-0000000008a2'), 'удаление матча оставляет архив');

-- 4. Каскад при удалении игрока не ломается
select lives_ok($$delete from players where id = '00000000-0000-0000-0000-00000000d003'$$, 'удаление игрока с архивными баллами проходит');
select ok(not exists (select 1 from point_events where id = '00000000-0000-0000-0000-0000000008a4'), 'строки архива удалённого игрока удалены каскадом');

-- 5. Старые функции недоступны
select ok(not has_function_privilege('authenticated', 'award_bonus(uuid,integer,text)', 'execute'), 'award_bonus: нет прав у authenticated');
select ok(not has_function_privilege('authenticated', 'revoke_bonus(uuid)', 'execute'), 'revoke_bonus: нет прав у authenticated');
select ok(not has_function_privilege('authenticated', 'recalc_match_points(uuid)', 'execute'), 'recalc_match_points: нет прав у authenticated');
select ok(not has_function_privilege('anon', 'award_bonus(uuid,integer,text)', 'execute')
       and not has_function_privilege('anon', 'revoke_bonus(uuid)', 'execute')
       and not has_function_privilege('anon', 'recalc_match_points(uuid)', 'execute'), 'старые функции: нет прав у anon');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 5, 'мимо лимитов')$$, '42501', null, 'тренер не может вызвать award_bonus');
select throws_ok($$select recalc_match_points()$$, '42501', null, 'администратор и тренер не могут вызвать recalc_match_points');
reset role;
select is(n_bonus(), 1, 'старый путь не прислал родителю уведомление');

-- 6. Ручные баллы до даты старта закрываются
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 2, 'Старание', '00000000-0000-0000-0000-0000000009a1')$$, 'ручной балл по новым правилам начисляется');
reset role;
-- ручной балл с датой после будущего старта (вставка как из пересчёта, для проверки границы)
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d002', tbilisi_day(now()) + 5, 'manual', '00000000-0000-0000-0000-0000000009a2', 'manual', 1, '{"note":"после старта"}');

-- «Сверка» видит ручной балл до даты старта как расхождение, пока дата задана в обход триггера
alter table club_settings disable trigger points_start_sync;
insert into club_settings (club_id, key, value, scope, updated_at)
  values ('00000000-0000-0000-0000-00000000c001', 'points_start', to_char(tbilisi_day(now()) + 1, 'YYYY-MM-DD'), '', current_date);
select ok((select points_consistency_run(false) -> 'drift') @> '[{"source_type": "manual", "source_id": "00000000-0000-0000-0000-0000000009a1"}]'::jsonb,
  'сверка показывает ручной балл до даты старта как расхождение');
select is((select status from points_ledger where source_id = '00000000-0000-0000-0000-0000000009a1'), 'active', 'сверка без исправления ничего не меняет');
delete from club_settings where key = 'points_start';
alter table club_settings enable trigger points_start_sync;

-- установка даты старта (как set_points_start): пересчёт в конце транзакции
insert into club_settings (club_id, key, value, scope, updated_at)
  values ('00000000-0000-0000-0000-00000000c001', 'points_start', to_char(tbilisi_day(now()) + 1, 'YYYY-MM-DD'), '', current_date);
set constraints all immediate; set constraints all deferred;
select is((select status from points_ledger where source_id = '00000000-0000-0000-0000-0000000009a1'), 'cancelled', 'ручной балл до даты старта закрыт');
select is((select cancel_reason from points_ledger where source_id = '00000000-0000-0000-0000-0000000009a1'), 'points_start', 'причина закрытия: points_start');
select is((select count(*)::int from points_ledger_audit a join points_ledger l on l.id = a.ledger_id
            where l.source_id = '00000000-0000-0000-0000-0000000009a1' and a.action = 'cancel'), 1, 'закрытие записано в аудит');
select is((select status from points_ledger where source_id = '00000000-0000-0000-0000-0000000009a2'), 'active', 'ручной балл с датой не раньше старта не тронут');
select is((points_consistency_run(true) ->> 'changes')::int, 0, 'повторный пересчёт ничего не меняет');

delete from club_settings where key = 'points_start';
set constraints all immediate; set constraints all deferred;
select is((select status from points_ledger where source_id = '00000000-0000-0000-0000-0000000009a1' order by created_at desc limit 1), 'cancelled',
  'снятие даты старта не возвращает закрытый ручной балл');

-- 7. Выгрузка данных родителя берёт новый журнал
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select jsonb_array_length(export_my_data() -> 'points')),
          (select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'),
          'выгрузка: столько строк баллов, сколько действующих строк журнала');
select ok(not exists (select 1 from jsonb_array_elements(export_my_data() -> 'points') e where e ->> 'explanation' like 'Архив%'), 'выгрузка не берёт point_events');
select ok(exists (select 1 from jsonb_array_elements(export_my_data() -> 'points') e where e ->> 'explanation' like 'Матч%' and (e ->> 'points')::int = 5),
  'выгрузка: строка матча с подписью и баллами');
reset role;

-- 8. Технический результат одной транзакцией
create temp table nb as select n_bonus() as c;
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match_tech(null, '00000000-0000-0000-0000-0000000000e1', null, tbilisi_day(now()) - 1, 'Неявка', 3, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":0,"best":false}]', true)$$,
  'save_match_tech: новый матч с техническим результатом');
reset role;
set constraints all immediate; set constraints all deferred;
select is((select technical from matches where opponent = 'Неявка'), true, 'признак технического результата сохранён');
select is((select count(*)::int from points_ledger l join matches m on m.id = l.source_id where m.opponent = 'Неявка'), 0, 'за технический результат строк журнала нет');
select is(n_bonus(), (select c from nb), 'за технический результат родитель уведомления не получил');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select save_match_tech(null, null, 'Сборная U12', tbilisi_day(now()) - 1, 'Турнир', 1, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"goals":0,"best":false}]', true)$$,
  'save_match_tech: матч команды без группы (как save_match_team)');
reset role;
select is((select technical from matches where team = 'Сборная U12'), true, 'матч команды без группы: признак сохранён');

select ok(not has_function_privilege('anon', 'save_match_tech(uuid,uuid,text,date,text,integer,integer,jsonb,boolean)', 'execute'), 'save_match_tech: нет прав у anon');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select save_match_tech(null, '00000000-0000-0000-0000-0000000000e1', null, tbilisi_day(now()) - 1, 'X', 1, 0, '[]', false)$$, '42501', null,
  'родитель не может сохранить матч через save_match_tech');
reset role;

select * from finish();
rollback;
