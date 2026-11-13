-- pgTAP: взнос за товарищеский матч снимается у неигравших — match_fees_sync_played (0197). Условия: docs/MATCH_FEES_SYNC_PLAYED_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(18);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0197_match_fees_sync_played.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7802, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7803, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Играл'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Не играл'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Не играл, заплатил'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Не играл, оплата отменена'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Без отметки');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-14', 'U13', 'Соперник'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-11-15', 'U13', 'До игры');
insert into match_fees (match_id, player_id, amount) select '00000000-0000-0000-0000-0000000000f1', id, 25 from players;
insert into match_fees (match_id, player_id, amount) select '00000000-0000-0000-0000-0000000000f2', id, 25 from players;
-- f1: d001 играл, d002 не играл, d003 заплатил (не играл), d004 платёж отменён (не играл), d005 без строки состава
insert into match_players (match_id, player_id, played) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', false),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003', false),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d004', false),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d001', false),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d002', false);
insert into match_payments (id, match_id, player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003', 25, '2026-11-13', 'Наличные'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d004', 25, '2026-11-13', 'Наличные');
insert into match_payments (match_id, player_id, amount, paid_on, method, cancels) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d004', -25, '2026-11-13', 'Наличные', '00000000-0000-0000-0000-0000000000a4');
insert into tournaments (id, club_id, kind, team, name, fee) values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000c001', 'championship', 'U13', 'Чемпионат', 0);
insert into matches (id, club_id, played_on, team, opponent, tournament_id) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c001', '2026-11-02', 'U13', 'Чемпионатный', '00000000-0000-0000-0000-0000000000a9');
insert into match_fees (match_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d002', 25);
insert into match_players (match_id, player_id, played) values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d001', true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 8. права
select ok(has_function_privilege('authenticated', 'match_fees_sync_played(uuid)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'match_fees_sync_played(uuid)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');
select ok(not has_function_privilege('public', 'match_fees_sync_played(uuid)', 'execute'), 'public не вызывает функцию');

-- 1. доступ
select throws_ok($$select match_fees_sync_played('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'not authenticated', 'без входа нельзя');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_fees_sync_played('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'forbidden', 'родитель не вызывает');
reset role;
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f1'), 5, 'после отказов взносы не тронуты');

-- 4. до игры никто не отмечен: ничего не удаляется
select as_user('00000000-0000-0000-0000-0000000000c1');
select is(match_fees_sync_played('00000000-0000-0000-0000-0000000000f2'), 0, 'до игры (никто не «Играл») возвращает 0');
reset role;
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f2'), 5, 'до игры все взносы на месте');

-- 2-3. тренер сохраняет после отметок
select as_user('00000000-0000-0000-0000-0000000000c1');
select is(match_fees_sync_played('00000000-0000-0000-0000-0000000000f1'), 2, 'удалены взносы неигравших без оплат (d002 и d005)');
reset role;
select is((select array_agg(player_id order by player_id)::text from match_fees where match_id = '00000000-0000-0000-0000-0000000000f1'), '{00000000-0000-0000-0000-00000000d001,00000000-0000-0000-0000-00000000d003,00000000-0000-0000-0000-00000000d004}', 'остались игравший и двое с оплатами');
select is((select count(*)::int from match_payments where match_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'оплаты не удалены');
select is((select amount from match_fees where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d001'), 25.00::numeric, 'сумма играющего не изменилась');

-- повтор безопасен
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(match_fees_sync_played('00000000-0000-0000-0000-0000000000f1'), 0, 'повторный вызов ничего не удаляет');

-- 5. чемпионат не затрагивается
select is(match_fees_sync_played('00000000-0000-0000-0000-0000000000f3'), 0, 'матч чемпионата не затрагивается');
reset role;
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f3'), 1, 'взнос в матче чемпионата на месте');

-- кубок: у матча кубка взнос свой, неигравшие без оплаты снимаются
reset role;
insert into tournaments (id, club_id, kind, team, name, fee) values ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-00000000c001', 'cup', 'U13', 'Кубок', 0);
insert into matches (id, club_id, played_on, team, opponent, tournament_id) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000c001', '2026-11-03', 'U13', 'Кубковый', '00000000-0000-0000-0000-0000000000a8');
insert into match_fees (match_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000d001', 25),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000d002', 25);
insert into match_players (match_id, player_id, played) values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000d001', true);
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(match_fees_sync_played('00000000-0000-0000-0000-0000000000f4'), 1, 'матч кубка: взнос неигравшего снят');
reset role;
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f4'), 1, 'в матче кубка остался взнос игравшего');

-- 6. ошибки
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select match_fees_sync_played('00000000-0000-0000-0000-0000000000ff')$$, 'P0001', 'match not found', 'нет матча');

select * from finish();
rollback;
