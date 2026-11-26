-- pgTAP: исторические начисления за матч (до 2026-12-01, старая формула) при повторном сохранении матча после 0223/0224.
-- Сценарий проверяющего: версия правил от 2026-11-01 со старой формулой, версия от 2026-12-01 на модели оценки (после 0224),
-- ноябрьский матч с действующим начислением старой формулы; тренер сохраняет матч повторно (с тем же и с другим счётом, без оценок и с оценками).
-- Ожидание: начисление остаётся действующим. Закрывает его только смена points_start (решение 05.11), это проверяется отдельно.
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7902, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U10-A');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active');
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие в матче', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа команды в матче', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший игрок матча', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол в матче', '2020-01-01');
insert into points_rule_versions (id, club_id, effective_from, params)
select v.id::uuid, '00000000-0000-0000-0000-00000000c001', v.d, jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1), 'match', v.m,
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()), 'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true))
from (values
  ('00000000-0000-0000-0000-0000000000f1', date '2026-11-01', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0)),
  ('00000000-0000-0000-0000-0000000000f2', date '2026-12-01', jsonb_build_object('model', 'rating', 'rating_min', 1, 'rating_max', 5, 'best', 1, 'cap', 6, 'technical', 0, 'played', 0, 'draw', 0, 'win', 0, 'goal', 0))
) v(id, d, m);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function r(n int, played boolean, goals int, rating int, best boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('player_id', ('00000000-0000-0000-0000-00000000d00' || n)::uuid, 'played', played, 'goals', goals, 'performance_rating', rating, 'best', best) $$;
create or replace function sv(gf int, ga int, roster jsonb) returns uuid language plpgsql as $$
declare x uuid;
begin
  x := save_match('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e1', date '2026-11-20', 'Соперник', gf, ga, roster);
  set constraints all immediate;
  set constraints all deferred;
  return x;
end $$;
create or replace function led() returns text language sql stable as $$
  select coalesce(string_agg(player_id::text, '') filter (where false), '') || coalesce(string_agg(right(player_id::text, 1) || ':' || points || ':' || status || ':' || coalesce(components ->> 'model', 'old'), ', ' order by player_id, created_at), '')
    from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa01' $$;

-- ноябрьский матч, действующие начисления старой формулы (как их писал прежний points_reconcile_match: победа 3:1, Аня с голами и лучший)
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against)
  values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000c001', '2026-11-20', 'U10', 'Соперник', 3, 1);
alter table match_players disable trigger user;
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d001', true, 2, true),
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d002', true, 0, false);
alter table match_players enable trigger user;
select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'match', '00000000-0000-0000-0000-00000000aa01', jsonb_build_array(
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-11-20', 'reason_code', 'match', 'points', 5,
    'components', '{"result":"win","technical":false,"base":2,"goals":2,"best":2,"before_cap":6,"cap":5}'::jsonb, 'rule_version_id', '00000000-0000-0000-0000-0000000000f1'),
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d002', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-11-20', 'reason_code', 'match', 'points', 2,
    'components', '{"result":"win","technical":false,"base":2,"goals":0,"best":0,"before_cap":2,"cap":5}'::jsonb, 'rule_version_id', '00000000-0000-0000-0000-0000000000f1')), 'match_changed');
select is(led(), '1:5:active:old, 2:2:active:old', 'исходное состояние: два действующих начисления старой формулы');

select as_user('00000000-0000-0000-0000-0000000000c1');
-- 1. повторное сохранение без изменений, без оценок
select lives_ok($$select sv(3, 1, jsonb_build_array(r(1, true, 2, null, true), r(2, true, 0, null, false)))$$, 'повторное сохранение ноябрьского матча без оценок');
reset role;
select is(led(), '1:5:active:old, 2:2:active:old', 'начисления старой формулы остались действующими');
select as_user('00000000-0000-0000-0000-0000000000c1');
-- 2. другой счёт и голы
select lives_ok($$select sv(0, 2, jsonb_build_array(r(1, true, 0, null, true), r(2, true, 0, null, false)))$$, 'сохранение с другим счётом и голами');
reset role;
select is(led(), '1:5:active:old, 2:2:active:old', 'смена счёта и голов начисления не закрыла и не пересчитала');
select as_user('00000000-0000-0000-0000-0000000000c1');
-- 3. с оценками (тренер заполнил), смена лучшего
select lives_ok($$select sv(0, 2, jsonb_build_array(r(1, true, 0, 3, false), r(2, true, 0, 5, true)))$$, 'сохранение с оценками и другим лучшим');
reset role;
select is(led(), '1:5:active:old, 2:2:active:old', 'до даты модели оценки начисления по оценке не создаются, старые остаются');
select is((select count(*)::int from points_ledger_audit where source_id = '00000000-0000-0000-0000-00000000aa01' and action <> 'create'), 0, 'аудит: закрытий и замен нет');
select as_user('00000000-0000-0000-0000-0000000000c1');
-- 4. снятие участия и удаление игрока тоже не трогают прежнее начисление (прежние даты вне модели оценки)
select lives_ok($$select sv(0, 2, jsonb_build_array(r(2, false, 0, null, false)))$$, 'снятие участия у второго игрока');
reset role;
select is(led(), '1:5:active:old, 2:2:active:old', 'начисление игрока со снятой отметкой не закрывается (дата вне модели оценки)');

-- 5. смена points_start на 2026-12-01 (решение 05.11) закрывает ноябрьские начисления по своему механизму
insert into club_settings (club_id, key, value, scope, updated_at) values ('00000000-0000-0000-0000-00000000c001', 'points_start', '2026-12-01', '', current_date);
set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa01' and status = 'active'), 0, 'points_start 2026-12-01 закрывает ноябрьские начисления (прежний механизм)');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select sv(0, 2, jsonb_build_array(r(1, true, 0, 3, true)))$$, 'повторное сохранение после points_start');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa01' and status = 'active'), 0, 'после points_start ноябрьский матч новых начислений не получает');
select is((select string_agg(distinct status, ',') from points_ledger where source_id = '00000000-0000-0000-0000-00000000aa01'), 'cancelled', 'закрытые строки помечены cancelled с причиной points_start');

select * from finish();
rollback;
