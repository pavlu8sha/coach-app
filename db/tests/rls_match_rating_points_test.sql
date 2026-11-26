-- pgTAP: баллы за матч по оценке тренера (0223, 0224). Условия: docs/MATCH_RATING_POINTS_ACCEPTANCE.md. Фикстуры вымышленные.
-- Помощники sv и sv_tech вызывают save_match и сразу применяют отложенные проверки и пересчёт (как конец транзакции в приложении).
begin;
create extension if not exists pgtap;
select plan(71);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
-- 0225: remove_match_player сверяет клуб матча с клубом пользователя, при двух клубах у тренеров он задан
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 7801, 'Админ', true, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c1', 7802, 'Тренер', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c2', 7803, 'Тренер чужого клуба', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000b1', 7804, 'Родитель', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U10-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'U10-X');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name, status)
  select ('00000000-0000-0000-0000-00000000d00' || n)::uuid, '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок ' || n, 'active'
    from generate_series(1, 6) n;
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());

-- старые правила рейтинга: save_match по-прежнему вызывает замороженный apply_match_points (0186), ему нужны строки rules
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие в матче', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа команды в матче', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший игрок матча', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол в матче', '2020-01-01');

-- версии правил: старая модель с 2020 года (исторические матчи) и модель оценки с 2024 года (как после 0224)
insert into points_rule_versions (club_id, effective_from, params)
select '00000000-0000-0000-0000-00000000c001', v.d, jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', v.m,
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true))
from (values
  (date '2020-01-01', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0)),
  (date '2024-01-01', jsonb_build_object('model', 'rating', 'rating_min', 1, 'rating_max', 5, 'best', 1, 'cap', 6, 'technical', 0, 'played', 0, 'draw', 0, 'win', 0, 'goal', 0))
) v(d, m);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function pid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000d00' || n)::uuid $$;
-- строка состава: игрок, играл, голы, оценка, лучший
create or replace function r(n int, played boolean, goals int, rating int, best boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('player_id', pid(n), 'played', played, 'goals', goals, 'performance_rating', rating, 'best', best) $$;
create or replace function sv(m uuid, gf int, ga int, roster jsonb, g uuid default '00000000-0000-0000-0000-0000000000e1') returns uuid language plpgsql as $$
declare x uuid;
begin
  x := save_match(m, g, (select played_on from matches where id = m), 'Соперник', gf, ga, roster);
  set constraints all immediate;
  set constraints all deferred;
  return x;
end $$;
create or replace function sv_tech(m uuid, gf int, ga int, roster jsonb, tech boolean) returns uuid language plpgsql as $$
declare x uuid;
begin
  x := save_match_tech(m, '00000000-0000-0000-0000-0000000000e1', null, (select played_on from matches where id = m), 'Соперник', gf, ga, roster, tech);
  set constraints all immediate;
  set constraints all deferred;
  return x;
end $$;
create or replace function pts(m uuid) returns int[] language sql stable as $$
  select coalesce(array_agg(points order by player_id), '{}') from points_ledger where source_type = 'match' and source_id = m and status = 'active' $$;
create or replace function audit_n() returns int language sql stable as $$ select count(*)::int from points_ledger_audit where source_id::text like '00000000-0000-0000-0000-00000000aa0%' $$;

insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000c001', '2025-03-10', 'U10', 'Соперник'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000c001', '2025-03-11', 'U10', 'Соперник'),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000c001', '2025-03-12', 'U10', 'Соперник'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-00000000c001', '2025-03-13', 'U10', 'Соперник'),
  ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000c001', '2023-05-01', 'U10', 'Соперник'),
  ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-00000000c001', '2025-04-10', 'U10', 'Соперник');

-- 1-2, 4, 5. оценки 1-5 и лучший: 5 + 1 = 6; голы и счёт баллов не дают; не игравший баллов не получает
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 1, false), r(2, true, 0, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, false), r(5, true, 3, 5, true), r(6, false, 0, null, false)))$$, 'тренер сохраняет матч с оценками');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[1, 2, 3, 4, 6], 'оценки 1, 2, 3, 4 и 5 + лучший = 6');
select is((select count(*)::int from points_ledger where player_id = pid(6)), 0, 'не игравший баллов не получает');
select is((select components from points_ledger where player_id = pid(5) and status = 'active'),
  '{"model":"rating","rating":5,"best":true,"best_bonus":1,"before_cap":6,"cap":6,"technical":false}'::jsonb, 'в основании оценка, лучший и бонус');
select is((select (components ? 'goals') or (components ? 'result') or (components ? 'base') from points_ledger where player_id = pid(5) and status = 'active'), false, 'в основании нет голов, результата и участия');

-- 3. оценка 2 + лучший = 3
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa02', 2, 0, jsonb_build_array(r(1, true, 0, 2, true), r(2, true, 0, 5, false)))$$, 'второй матч');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa02'), array[3, 5], 'оценка 2 + лучший = 3, оценка 5 без лучшего = 5');
select is(audit_n(), 7, 'аудит: семь созданных строк');

-- 6, 7, 13. счёт, голы, победа, ничья и поражение баллы не меняют; повтор без дублей
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 1, false), r(2, true, 0, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, false), r(5, true, 3, 5, true), r(6, false, 0, null, false)))$$, 'повторное сохранение без изменений');
reset role;
select is(audit_n(), 7, 'повтор не создаёт строк и аудита');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa01'), 5, 'дублей в журнале нет');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 1, 1, jsonb_build_array(r(1, true, 0, 1, false), r(2, true, 1, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, false), r(5, true, 0, 5, true), r(6, false, 0, null, false)))$$, 'ничья 1:1, другие голы');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 0, 2, jsonb_build_array(r(1, true, 0, 1, false), r(2, true, 0, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, false), r(5, true, 0, 5, true), r(6, false, 0, null, false)))$$, 'поражение 0:2, голов нет');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[1, 2, 3, 4, 6], 'победа, ничья, поражение и голы баллы не меняют');
select is(audit_n(), 7, 'смена счёта и голов не пишет в аудит баллов');

-- 8. смена оценки пересчитывает: старая строка закрыта, новая создана
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 4, false), r(2, true, 0, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, false), r(5, true, 0, 5, true), r(6, false, 0, null, false)))$$, 'оценка первого игрока 1 -> 4');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[4, 2, 3, 4, 6], 'новая оценка = 4 балла');
select is((select count(*)::int from points_ledger where player_id = pid(1) and source_id = '00000000-0000-0000-0000-00000000aa01' and status = 'superseded'), 1, 'старая строка закрыта');
select is(audit_n(), 8, 'исправление записано в аудит');
select is((select count(*)::int from notifications where kind = 'bonus'), 0, 'исправление матча давней даты не уведомляет');

-- 9. смена лучшего переносит бонус
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 4, false), r(2, true, 0, 2, false), r(3, true, 0, 3, false), r(4, true, 0, 4, true), r(5, true, 0, 5, false), r(6, false, 0, null, false)))$$, 'лучший теперь четвёртый');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[4, 2, 3, 5, 5], 'бонус перешёл: 4+1 и 5');

-- 10. снятие участия отменяет начисление и очищает оценку
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(3, false, 0, null, false)))$$, 'третьему снята отметка «Играл»');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[4, 2, 5, 5], 'начисление третьему снято');
select is((select performance_rating from match_players where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(3)), null, 'оценка очищена при снятии отметки');

-- 11-12. лучший только из сыгравших и только один; неверная оценка
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 3, true), r(6, false, 0, null, true)))$$, 'P0001', 'best player must have played', 'лучшим нельзя назначить не игравшего');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 3, true), r(2, true, 0, 3, true)))$$, 'P0001', 'only one best player', 'двух лучших назначить нельзя');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 6, true)))$$, 'P0001', 'invalid rating', 'оценка 6 отклонена');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 0, true)))$$, 'P0001', 'invalid rating', 'оценка 0 отклонена');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, false, 0, 3, false)))$$, 'P0001', 'rating without playing', 'оценка не игравшему отклонена');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 3, false), r(2, true, 0, null, false)))$$, '23514', 'ratings incomplete', 'у сыгравшего нет оценки: матч со счётом не сохраняется');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa04', 1, 0, jsonb_build_array(r(1, true, 0, 3, false), r(2, true, 0, 4, false)))$$, '23514', 'best player required', 'нет лучшего игрока: матч со счётом не сохраняется');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa04'), '{}'::int[], 'отклонённые сохранения баллов не дали');

-- 15. матч без результата не начисляет, оценки до счёта допустимы
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa04', null, null, jsonb_build_array(r(1, true, 0, 3, false), r(2, true, 0, null, false)))$$, 'без счёта состав сохраняется и без полного набора оценок');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa04'), '{}'::int[], 'матч без результата баллов не даёт');

-- 16. технический результат: баллов нет, оценки не нужны; снятие признака без оценок отклоняется
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv_tech('00000000-0000-0000-0000-00000000aa03', 3, 0, jsonb_build_array(r(1, true, 0, null, false), r(2, true, 0, null, false)), true)$$, 'технический результат без оценок сохраняется');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa03'), '{}'::int[], 'технический результат баллов не даёт');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select sv_tech('00000000-0000-0000-0000-00000000aa03', 3, 0, jsonb_build_array(r(1, true, 0, null, false), r(2, true, 0, null, false)), false)$$, '23514', 'ratings incomplete', 'без признака технического нужны оценки');
select lives_ok($$select sv_tech('00000000-0000-0000-0000-00000000aa03', 3, 0, jsonb_build_array(r(1, true, 0, 3, true), r(2, true, 0, 4, false)), false)$$, 'с оценками признак снимается');
reset role;
select is(pts('00000000-0000-0000-0000-00000000aa03'), array[4, 4], 'после снятия признака баллы по оценке');

-- 17. старая версия правил: записи без оценки фиктивных баллов не получают и не блокируют сохранение
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa05', 2, 0, jsonb_build_array(r(1, true, 2, null, true), r(2, true, 0, null, false)))$$, 'матч старой версии правил без оценок сохраняется');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa05'), 0, 'историческая запись без оценки баллов не получает');

-- историческое начисление старой формулы у матча до модели оценки не закрывается и не пересчитывается при правке матча
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  values ('00000000-0000-0000-0000-00000000c001', pid(1), '2023-05-01', 'match', '00000000-0000-0000-0000-00000000aa05', 'match', 5, '{"result":"win","base":2,"goals":2,"best":2,"before_cap":6,"cap":5}');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa05', 3, 0, jsonb_build_array(r(1, true, 2, null, true), r(2, true, 0, null, false)))$$, 'правка счёта исторического матча без оценок');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa05', 3, 0, jsonb_build_array(r(1, true, 2, 5, true), r(2, true, 0, 3, false)))$$, 'правка исторического матча с оценками');
reset role;
select is((select string_agg(points::text || status, ',') from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa05'), '5active', 'старое начисление осталось действующим, новых строк по оценке нет');
select is((select count(*)::int from points_ledger_audit where source_id = '00000000-0000-0000-0000-00000000aa05' and action <> 'create'), 0, 'правки исторического матча не закрывали начисление');

-- 18. история исправлений: оценка в before и after, автор и время
select is((select before ->> 'performance_rating' from match_revisions where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(1) and action = 'update' order by id limit 1), '1', 'before: прежняя оценка');
select is((select after ->> 'performance_rating' from match_revisions where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(1) and action = 'update' order by id limit 1), '4', 'after: новая оценка');
select is((select actor_id from match_revisions where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(1) and action = 'update' order by id limit 1), '00000000-0000-0000-0000-0000000000c1'::uuid, 'автор исправления записан');

-- remove_match_player очищает оценку и баллы
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-00000000aa01', pid(2))$$, 'тренер убирает игрока из матча');
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pts('00000000-0000-0000-0000-00000000aa01'), array[4, 5, 5], 'баллы убранного игрока сняты');
select is((select count(*)::int from match_revisions where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(2) and before ->> 'performance_rating' = '2' and after ->> 'performance_rating' is null), 1, 'очистка оценки записана в историю');

-- удаление матча снимает баллы
delete from matches where id = '00000000-0000-0000-0000-00000000aa02';
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa02' and status = 'active'), 0, 'удаление матча снимает баллы');

-- 21-22. доступ: чужой клуб, родитель, прямые записи
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 5, true)), '00000000-0000-0000-0000-0000000000e2')$$, '42501', 'match is not of this group', 'тренер другого клуба не меняет чужой матч');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select sv('00000000-0000-0000-0000-00000000aa01', 3, 1, jsonb_build_array(r(1, true, 0, 5, true)))$$, '42501', 'forbidden', 'родитель не сохраняет матч и оценки');
update match_players set performance_rating = 5 where match_id = '00000000-0000-0000-0000-00000000aa01';
select throws_ok($$update points_ledger set points = 99$$, '42501', null, 'родитель не правит баллы');
select throws_ok($$insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points) values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', '2025-03-10', 'match', gen_random_uuid(), 'match', 6)$$, '42501', null, 'родитель не пишет в журнал');
select as_user('00000000-0000-0000-0000-0000000000c1');
update match_players set performance_rating = 1 where match_id = '00000000-0000-0000-0000-00000000aa01';
reset role;
select is((select performance_rating from match_players where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(1)), 4::smallint, 'прямая запись оценки родителем и тренером ничего не меняет');
select ok(not has_table_privilege('authenticated', 'points_ledger', 'update') and not has_table_privilege('authenticated', 'points_ledger', 'insert'), 'у authenticated нет прав записи в журнал баллов');
select ok(not has_function_privilege('authenticated', 'points_reconcile_match(uuid)', 'execute') and not has_function_privilege('authenticated', 'match_rating_check(uuid)', 'execute'), 'внутренние функции расчёта недоступны приложению');

-- 14. равенство мест (PR #513) не меняется: баллы за матч 5, 5, 5, 4 дают места 1, 1, 1, 4
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv('00000000-0000-0000-0000-00000000aa06', 2, 0, jsonb_build_array(r(1, true, 0, 4, true), r(2, true, 0, 5, false), r(3, true, 0, 5, false), r(4, true, 0, 4, false), r(5, true, 0, 1, false), r(6, true, 0, 1, false)))$$, 'матч для проверки мест');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (points_group_benchmark(pid(1), date '2025-04-01') -> 'groups' -> 0 ->> 'place')::int), 1, 'место при 5, 5, 5, 4: первый из троих делит 1 место');
select is((select (points_group_benchmark(pid(3), date '2025-04-01') -> 'groups' -> 0 ->> 'place')::int), 1, 'третий из троих тоже на 1 месте');
select is((select (points_group_benchmark(pid(4), date '2025-04-01') -> 'groups' -> 0 ->> 'place')::int), 4, 'четвёртый на 4 месте (3 места пропущены)');
reset role;

-- удаление единственного лучшего: тренер может убрать его без отказа, нового лучшего база не назначает
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-00000000aa06', pid(1))$$, 'тренер убирает единственного лучшего из матча');
reset role;
select lives_ok($$set constraints all immediate$$, 'удаление лучшего проходит проверку на итоговом состоянии');
set constraints all deferred;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-00000000aa06' and best), 0, 'новый лучший автоматически не назначен');
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-00000000aa06' and player_id = pid(1)), 0, 'убранный игрок удалён из состава матча');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa06' and player_id = pid(1) and status = 'active'), 0, 'баллы убранного лучшего сняты');
select is(pts('00000000-0000-0000-0000-00000000aa06'), array[5, 5, 4, 1, 1], 'остальные сохраняют баллы за оценку без бонуса');

-- прямая запись администратора не обходит проверку полноты (при подтверждении на итоговом состоянии)
select as_user('00000000-0000-0000-0000-0000000000a1');
update match_players set performance_rating = null where match_id = '00000000-0000-0000-0000-00000000aa01' and player_id = pid(1);
select throws_ok($$set constraints all immediate$$, '23514', 'ratings incomplete', 'прямая запись администратора без оценки отклоняется');
reset role;

select * from finish();
rollback;
