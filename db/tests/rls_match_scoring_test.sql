-- pgTAP: схема баллов за матч (победа 2, лучший 3, поражение/ничья 1, гол +1) и правка матчей администратором.
begin;
create extension if not exists pgtap;
select plan(26);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 6101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 6102, 'Тренер U9', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок U11');
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие в матче', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа команды в матче', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший игрок матча', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол в матче', '2026-01-01');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U11', 'Чужой соперник');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function pts(p uuid) returns int language sql as $$ select coalesce(sum(points), 0)::int from point_events where player_id = p $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
-- Победа 3:1: лучший — игрок 1 (1 гол), игрок 2 играл, игрок 3 не играл
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 3, 1,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":1,"best":true},
    {"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"goals":0},
    {"player_id":"00000000-0000-0000-0000-00000000d003","played":false,"goals":0}]'::jsonb)$$, 'победа: тренер вносит матч с лучшим игроком');
select is(pts('00000000-0000-0000-0000-00000000d001'), 4, 'лучший игрок: 3 (вместо 2) + 1 гол');
select is(pts('00000000-0000-0000-0000-00000000d002'), 2, 'играл при победе: 2 балла');
select is(pts('00000000-0000-0000-0000-00000000d003'), 0, 'не играл: баллов нет');
select is((select count(*)::int from point_events where player_id = '00000000-0000-0000-0000-00000000d001' and explanation = 'Победа команды в матче'), 0, 'лучшему не начисляется ещё и обычная победа');

-- Лучшим становится другой игрок: прежний возвращается к баллам за победу
select lives_ok($$select save_match((select id from matches where opponent = 'Динамо'), '00000000-0000-0000-0000-0000000000e1', '2026-10-17', 'Динамо', 3, 1,
  '[{"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"goals":0,"best":true}]'::jsonb)$$, 'лучшим назначен другой игрок');
select is(pts('00000000-0000-0000-0000-00000000d002'), 3, 'новый лучший: 3');
select is(pts('00000000-0000-0000-0000-00000000d001'), 3, 'прежний лучший: 2 за победу + 1 гол');
select is((select count(*)::int from match_players where best), 1, 'лучший игрок в матче один');

-- Поражение и ничья
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-18', 'Олимп', 0, 2,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":0,"best":true},
    {"player_id":"00000000-0000-0000-0000-00000000d003","played":true,"goals":0}]'::jsonb)$$, 'поражение 0:2');
select is((select sum(points)::int from point_events where source_id = (select id from matches where opponent = 'Олимп')), 2, 'при поражении играющим по 1 баллу, лучший без бонуса');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-19', 'Ничья FC', 1, 1,
  '[{"player_id":"00000000-0000-0000-0000-00000000d003","played":true,"goals":1}]'::jsonb)$$, 'ничья 1:1');
select is((select sum(points)::int from point_events where source_id = (select id from matches where opponent = 'Ничья FC')), 2, 'ничья: 1 за матч + 1 гол');

-- Счёта ещё нет: баллы за результат не начисляются
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', (current_date + 3), 'Будущий', null, null,
  '[{"player_id":"00000000-0000-0000-0000-00000000d003","played":true,"goals":0}]'::jsonb)$$, 'матч без счёта');
select is((select count(*)::int from point_events where source_id = (select id from matches where opponent = 'Будущий')), 0, 'без счёта баллов за матч нет');

-- Ограничения
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-20', 'X', 5, 0,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"best":true},{"player_id":"00000000-0000-0000-0000-00000000d002","played":true,"best":true}]'::jsonb)$$, null, 'only one best player', 'двух лучших нельзя');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-20', 'X', 5, 0,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":false,"best":true}]'::jsonb)$$, null, 'best player must have played', 'лучший должен был играть');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', null, '2026-10-10', 'X', 1, 0, '[]'::jsonb)$$, '42501', 'forbidden', 'тренер без группы чужой матч править не может');

-- Администратор: любой матч, любой игрок клуба, без указания группы
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', null, '2026-10-10', 'Чужой соперник', 2, 1,
  '[{"player_id":"00000000-0000-0000-0000-00000000d009","played":true,"goals":1},{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":0}]'::jsonb)$$, 'администратор правит любой матч и добавляет игрока другой группы');
select throws_ok($$select save_match(null, null, '2026-10-21', 'X', 1, 0, '[]'::jsonb)$$, null, 'group required', 'для нового матча группа обязательна');

-- Удаление и пересчёт
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select delete_match((select id from matches where opponent = 'Ничья FC'))$$, '42501', 'forbidden', 'тренер не удаляет матчи');
select throws_ok($$select recalc_match_points()$$, '42501', 'forbidden', 'тренер не пересчитывает баллы');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select delete_match((select id from matches where opponent = 'Ничья FC'))$$, 'администратор удаляет матч');
select is((select count(*)::int from point_events where explanation like 'Гол в матче%' and player_id = '00000000-0000-0000-0000-00000000d003' and occurred_on = '2026-10-19'), 0, 'вместе с матчем удалены его автобаллы');
reset role;
insert into rules (club_id, code, version, points, explanation, active_from) values ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 5, 'Победа (новая цена)', '2026-01-01');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(recalc_match_points(), 4, 'пересчёт по действующим правилам охватил все матчи с составом');
select is(pts('00000000-0000-0000-0000-00000000d001'), 12, 'после пересчёта победа стоит 5: (5 + гол 1) + поражение 1 + победа 5');

select * from finish();
rollback;
