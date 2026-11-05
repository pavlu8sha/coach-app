-- pgTAP: версионируемые правила баллов (0117). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7103, 'Родитель', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Стартовая версия из миграции (клуб создан тестом позже миграции, поэтому берём параметры из функции проверки)
create temp table base_params as select jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array(
    jsonb_build_object('count', 6, 'bonus', 1), jsonb_build_object('count', 12, 'bonus', 2),
    jsonb_build_object('count', 24, 'bonus', 4), jsonb_build_object('count', 48, 'bonus', 8))),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)
) as p;
grant select on base_params to authenticated;

select lives_ok($$select points_rules_validate((select p from base_params))$$, 'стартовые параметры проходят проверку');
select throws_ok($$select points_rules_validate((select jsonb_set(p, '{match,cap}', '0') from base_params))$$, '22023', 'match.cap must be integer 1..50', 'лимит матча 0 отклоняется');
select throws_ok($$select points_rules_validate((select jsonb_set(p, '{training,group}', '-1') from base_params))$$, '22023', 'training.group must be integer 0..20', 'отрицательные баллы отклоняются');
select throws_ok($$select points_rules_validate((select jsonb_set(p, '{manual,limits}', '{"4": 1}') from base_params))$$, '22023', 'manual.limits key 4 is not in values', 'лимит для недопустимого размера отклоняется');
select throws_ok($$select points_rules_validate((select jsonb_set(p, '{series,thresholds}', '[{"count":12,"bonus":2},{"count":6,"bonus":1}]') from base_params))$$, '22023', 'series.thresholds counts must increase', 'рубежи серий должны возрастать');

-- права
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select points_rules_save(current_date + 30, (select p from base_params), 'x')$$, '42501', 'forbidden', 'родитель не меняет правила');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select points_rules_save(current_date + 30, (select p from base_params), 'x')$$, '42501', 'forbidden', 'тренер не меняет правила');
select throws_ok($$select * from points_rules_list()$$, '42501', 'forbidden', 'тренер не видит список версий через админ-функцию');

-- админ
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select points_rules_save(current_date - 1, (select p from base_params), 'x')$$, '22023', 'effective date in the past', 'нельзя вводить правила задним числом');
select is((select points_rules_save(current_date + 30, (select jsonb_set(p, '{training,group}', '2') from base_params), 'тест')) is not null, true, 'админ создаёт версию');
select is((select points_rules_save(current_date + 30, (select jsonb_set(p, '{training,group}', '2') from base_params), 'тест')) = (select id from points_rule_versions where effective_from = current_date + 30), true, 'повтор с теми же параметрами не создаёт дубль');
select is((select count(*)::int from points_rule_versions where effective_from = current_date + 30), 1, 'на дату одна версия');
select throws_ok($$select points_rules_save(current_date + 30, (select jsonb_set(p, '{training,group}', '3') from base_params), 'другое')$$, '23505', 'version for this date already exists', 'другие параметры на ту же дату отклоняются');

-- неизменность и аудит
select throws_ok($$update points_rule_versions set comment = 'x'$$, '42501', null, 'версию нельзя править напрямую');
select is((select count(*)::int from audit_log where action = 'points_rules_save'), 1, 'в аудит записана одна запись');
reset role;
select is((select (points_rules_for((select id from clubs limit 1), current_date + 31)).params #>> '{training,group}'), '2', 'на дату после вступления действует новая версия');

select * from finish();
rollback;
