-- pgTAP: баллы за матчи в новом журнале (0122). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7502, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7503, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- победа 3:1: Аня (3 гола, лучший) = 2+3+2 = 7 -> 5; Боря = 2; Вера не играла
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against)
  values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000c001', '2026-12-03', 'U10', 'Соперник', 3, 1);
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d001', true, 3, true),
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d002', true, 0, false),
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d003', false, 0, false);

select is((select count(*)::int from points_ledger), 0, 'расчёт отложен до конца транзакции');
set constraints all immediate;

select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), 5, 'победа + 3 гола + лучший = 7, но не больше 5');
select is((select (components ->> 'before_cap')::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), 7, 'до ограничения 7, видно в основании');
select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 2, 'победа без голов = 2');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d003'), 0, 'не играл: баллов нет');
select is((select group_id from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), '00000000-0000-0000-0000-0000000000e1'::uuid, 'группа игрока на дату матча');
select is((select count(*)::int from points_ledger where status = 'active'), 2, 'две действующие строки');

-- повтор и правка, не меняющая баллы
update matches set opponent = 'Другой' where id = '00000000-0000-0000-0000-00000000aa01';
select is((select count(*)::int from points_ledger_audit), 2, 'правка названия соперника баллы не трогает');
select is((select count(*)::int from match_revisions where entity = 'match' and action = 'update'), 1, 'правка матча записана в журнал исправлений');

-- ничья 1:1: Боря 1, Аня 1+3+2 = 6 -> 5
update matches set goals_for = 1, goals_against = 1 where id = '00000000-0000-0000-0000-00000000aa01';
select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 1, 'ничья: участие = 1');
select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), 5, 'ничья, у Ани по-прежнему 5');

-- поражение 0:2, Ане сняли голы: 1+0+2 = 3
update match_players set goals = 0 where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = '00000000-0000-0000-0000-00000000d001';
update matches set goals_for = 0, goals_against = 2 where id = '00000000-0000-0000-0000-00000000aa01';
select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), 3, 'поражение, без голов, лучший: 3');
select is((select count(*)::int from match_revisions where entity = 'player' and action = 'update'), 1, 'правка игрока записана в журнал исправлений');

-- Вера теперь играла
update match_players set played = true where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = '00000000-0000-0000-0000-00000000d003';
select is((select points from points_ledger where player_id = '00000000-0000-0000-0000-00000000d003' and status = 'active'), 1, 'отметка «Играл» добавляет участие');

-- права
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-00000000aa01', true)$$, '42501', 'forbidden', 'родитель не ставит технический результат');
select is((select count(*)::int from match_revisions), 0, 'родитель не видит журнал исправлений');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from match_revisions) > 0, true, 'тренер читает журнал исправлений');
select lives_ok($$select set_match_technical('00000000-0000-0000-0000-00000000aa01', true)$$, 'тренер ставит технический результат');
reset role;

select is((select count(*)::int from points_ledger where status = 'active'), 0, 'технический результат: баллов нет');
select throws_ok($$delete from match_revisions$$, '42501', 'match revisions are append-only', 'журнал исправлений не удаляется');

-- матч без счёта и матч до запуска правил баллов не дают
insert into matches (id, club_id, played_on, team, goals_for, goals_against)
  values ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000c001', '2026-12-05', 'U10', null, null),
         ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000c001', '2026-11-20', 'U10', 2, 0);
insert into match_players (match_id, player_id, played) values
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000d001', true),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000d001', true);
select is((select count(*)::int from points_ledger where status = 'active'), 0, 'без счёта и до запуска правил баллов нет');

-- снятие технического результата возвращает баллы, удаление матча их снимает
update matches set technical = false where id = '00000000-0000-0000-0000-00000000aa01';
select is((select count(*)::int from points_ledger where status = 'active'), 3, 'после снятия признака баллы вернулись');
delete from matches where id = '00000000-0000-0000-0000-00000000aa01';
select is((select count(*)::int from points_ledger where status = 'active'), 0, 'удаление матча снимает баллы');
select is((select count(*)::int from match_revisions where match_id = '00000000-0000-0000-0000-00000000aa01' and action = 'delete' and entity = 'match'), 1, 'удаление записано в журнал исправлений');

select * from finish();
rollback;
