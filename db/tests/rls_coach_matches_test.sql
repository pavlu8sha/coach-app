-- pgTAP: матчи, состав, счёт, голы и автобаллы за матч (тренер).
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 6001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 6002, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 6003, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 6004, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок из U11');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
-- правила рейтинга по новой схеме: участие 1 (поражение, ничья), победа 2, лучший 3, гол 1
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие в матче', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа команды в матче', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший игрок матча', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол в матче', '2026-01-01');
-- матч U11 (чужой для тренера U9), у него участник из U9 по match_fees не нужен
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U11', 'Чужой соперник');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Доступ
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 3, 1, '[]'::jsonb)$$, '42501', 'forbidden', 'родитель не вносит матч');
select as_user('00000000-0000-0000-0000-0000000000c2');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-18', 'Гость', null, null, '[]'::jsonb)$$, 'тренер другой группы вносит матч (тренеры ведут все группы)');

-- Тренер U9 создаёт матч: победа 3:1, играли двое, один забил два гола
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into matches (club_id, played_on, team) values ('00000000-0000-0000-0000-00000000c001', '2026-10-17', 'U9')$$, '42501', null, 'прямая запись матча тренеру закрыта');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 3, 1,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":2},
    {"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"goals":0},
    {"player_id":"00000000-0000-0000-0000-00000000d003","played":false,"goals":0}]'::jsonb)$$, 'тренер добавляет матч своей группы со счётом и составом');
select is((select team from matches where opponent = 'Динамо'), 'U9', 'команда матча — название группы');
select is((select count(*)::int from match_players), 3, 'три записи состава');
select is((select count(*)::int from point_events where source_type = 'match' and player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'у автора голов: победа и голы');
select is((select sum(points)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d001'), 4, 'баллы: 2 победа + 2 гола');
select is((select sum(points)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d002'), 2, 'у игрока без голов: 2 за победу');
select is((select count(*)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d003'), 0, 'тот, кто не играл, баллов не получает');
select is((select explanation from point_events where points = 2 and rule_id = (select id from rules where code = 'match_goal')), 'Гол в матче: 2', 'объяснение для родителя включает число голов');

-- Правка результата: на самом деле ничья 2:2, голы те же и ещё один у игрока 2
select lives_ok($$select save_match((select id from matches where opponent = 'Динамо'), '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 2, 2,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":1},
    {"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"goals":1}]'::jsonb)$$, 'тренер правит результат матча');
select is((select sum(points)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'пересчёт: 1 за ничью + 1 гол, без остатков победы');
select is((select sum(points)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d002'), 2, 'пересчёт у второго игрока: 1 + 1 гол');
select is((select count(*)::int from matches where opponent = 'Динамо'), 1, 'правка не создаёт второй матч');

-- Ограничения
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-10-10', 'Чужой соперник', null, null, '[]'::jsonb)$$, 'матч другой команды тренер править может (0042, 0055)');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'X', 1, null, '[]'::jsonb)$$, null, 'score incomplete', 'счёт только из двух чисел');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', (current_date + 7), 'X', 1, 0, '[]'::jsonb)$$, null, 'result for future match', 'результат будущего матча внести нельзя');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'X', 1, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":false,"goals":1}]'::jsonb)$$, null, 'goals without playing', 'гол без участия отклоняется');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'X', 1, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":2}]'::jsonb)$$, null, 'goals exceed team score', 'голов у игроков больше, чем в счёте команды');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'X', 1, 0, '[{"player_id":"00000000-0000-0000-0000-00000000d009","played":true,"goals":0}]'::jsonb)$$, 'игрока другой группы клуба тренер включает в состав (0055)');

-- Предстоящий матч без счёта и баллов
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', (current_date + 7), 'Будущий', null, null, '[]'::jsonb)$$, 'тренер добавляет предстоящий матч без счёта');

-- Участник из match_fees (администратор ведёт список) может сыграть за чужую группу
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into match_fees (match_id, player_id, amount) select id, '00000000-0000-0000-0000-00000000d009', 10 from matches where opponent = 'Динамо';
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match((select id from matches where opponent = 'Динамо'), '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 2, 2, '[{"player_id":"00000000-0000-0000-0000-00000000d009","played":true,"goals":0}]'::jsonb)$$, 'участник матча из списка взносов допускается');

-- Родитель видит баллы своего ребёнка
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select sum(points)::int from point_events), 2, 'родитель видит баллы только своего ребёнка');

select * from finish();
rollback;
