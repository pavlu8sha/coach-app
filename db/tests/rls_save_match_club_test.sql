-- pgTAP: save_match закрывает чужой клуб (0225, вместе с remove_match_player). Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md, раздел save_match. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(22);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- пересоздаём функцию под умолчаниями Supabase (тело берётся из миграции 0225)
drop function save_match(uuid, uuid, date, text, int, int, jsonb);
\i db/migrations/0225_remove_match_player_club.sql

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб А'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 7801, 'Админ А', true,  '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000a2', 7802, 'Админ Б', true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000a3', 7806, 'Админ без клуба', true, null),
  ('00000000-0000-0000-0000-0000000000c1', 7803, 'Тренер А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c2', 7804, 'Тренер Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000c3', 7807, 'Тренер без клуба', false, null),
  ('00000000-0000-0000-0000-0000000000b1', 7805, 'Родитель', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000e2', 'Игрок Б1');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U9', 'Соперник А'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c002', '2026-11-01', 'U9', 'Соперник Б');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select ok(has_function_privilege('authenticated', 'save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');

-- тренер чужого клуба: чужой матч с группой чужого клуба
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', '2026-11-01', 'Взлом', 5, 0, '[]'::jsonb)$$, '42501', 'forbidden', 'чужой тренер не сохраняет чужой матч');
-- создать матч в чужом клубе
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e2', '2026-11-02', 'Новый чужой', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'чужой тренер не создаёт матч в чужом клубе');
-- чужой матч с собственной группой (старая проверка)
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Взлом', 5, 0, '[]'::jsonb)$$, '42501', 'forbidden', 'чужой тренер не сохраняет чужой матч со своей группой');
-- несуществующий матч: прежняя ошибка
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'x', null, null, '[]'::jsonb)$$, 'P0001', 'match not found', 'нет матча');
reset role;
select is((select opponent from matches where id = '00000000-0000-0000-0000-0000000000f2'), 'Соперник Б', 'чужой матч не изменён');
select is((select goals_for from matches where id = '00000000-0000-0000-0000-0000000000f2'), null, 'счёт чужого матча не изменён');
select is((select count(*)::int from matches where club_id = '00000000-0000-0000-0000-00000000c002'), 1, 'в чужом клубе нет новых матчей');

-- администратор чужого клуба
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Взлом', 5, 0, '[]'::jsonb)$$, '42501', 'forbidden', 'администратор чужого клуба не сохраняет матч');
select throws_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-11-02', 'Новый', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'администратор чужого клуба не создаёт матч');
reset role;

-- тренер с неопределимым клубом (при двух клубах): запрет по умолчанию
select as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'x', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'тренер с неопределимым клубом получает отказ');
reset role;

-- родитель
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'x', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'родитель не сохраняет матч');
reset role;
select is((select opponent from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'Соперник А', 'после отказов матч своего клуба не изменён');

-- свой клуб: тренер обновляет и создаёт
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Новый соперник', null, null, '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true,"goals":0,"best":false}]'::jsonb)$$, 'тренер своего клуба сохраняет матч');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-11-03', 'Создан', null, null, '[]'::jsonb)$$, 'тренер своего клуба создаёт матч');
reset role;
select is((select opponent from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'Новый соперник', 'свой матч сохранён');
select is((select played from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d001'), true, 'состав своего матча сохранён');
select is((select club_id from matches where opponent = 'Создан'), '00000000-0000-0000-0000-00000000c001'::uuid, 'новый матч в клубе тренера');

-- администратор своего клуба и администратор без определимого клуба
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Админ А', null, null, '[]'::jsonb)$$, 'администратор своего клуба сохраняет матч');
select as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Админ без клуба', null, null, '[]'::jsonb)$$, 'администратор без клуба работает как раньше');
reset role;

-- без входа
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{}', true);
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'x', null, null, '[]'::jsonb)$$, '42501', 'not authenticated', 'без входа отказ');

select * from finish();
rollback;
