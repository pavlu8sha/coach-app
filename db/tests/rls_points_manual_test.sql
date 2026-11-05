-- pgTAP: ручные баллы тренера (0123). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7602, 'Тренер 1', false),
  ('00000000-0000-0000-0000-0000000000c2', 7603, 'Тренер 2', false),
  ('00000000-0000-0000-0000-0000000000b1', 7604, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'G2');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- правил ещё нет
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((points_manual_status('00000000-0000-0000-0000-00000000d001')) ->> 'active', 'false', 'до вступления правил функция сообщает active = false');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'x', gen_random_uuid())$$, '22023', 'points rules not active', 'до запуска начислять нельзя');
reset role;

insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', date '2020-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((points_manual_status('00000000-0000-0000-0000-00000000d001')) -> 'remaining' ->> '1', '3', 'осталось три начисления по +1');

select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Старание', '00000000-0000-0000-0000-000000000a01')$$, 'тренер начисляет +1');
select is((select count(*)::int from points_ledger where source_type = 'manual' and status = 'active'), 1, 'одна действующая запись');
select is((select components ->> 'note' from points_ledger where source_id = '00000000-0000-0000-0000-000000000a01'), 'Старание', 'комментарий сохранён');
select is(points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Старание', '00000000-0000-0000-0000-000000000a01'),
          (select id from points_ledger where source_id = '00000000-0000-0000-0000-000000000a01'), 'повтор заявки возвращает ту же запись');
select is((select count(*)::int from points_ledger where source_type = 'manual'), 1, 'повтор заявки дубля не создаёт');

select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Помощь', '00000000-0000-0000-0000-000000000a02')$$, 'второе +1');
select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Лидер', '00000000-0000-0000-0000-000000000a03')$$, 'третье +1');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Ещё', '00000000-0000-0000-0000-000000000a04')$$, '22023', 'monthly limit reached for this value', 'четвёртое +1 отклоняется');

-- отмена возвращает лимит
select throws_ok($$select points_manual_cancel((select id from points_ledger where source_id = '00000000-0000-0000-0000-000000000a03'), '  ')$$, '22023', 'reason required', 'отмена без причины отклоняется');
select lives_ok($$select points_manual_cancel((select id from points_ledger where source_id = '00000000-0000-0000-0000-000000000a03'), 'Ошибся ребёнком')$$, 'отмена с причиной');
select lives_ok($$select points_manual_cancel((select id from points_ledger where source_id = '00000000-0000-0000-0000-000000000a03'), 'Ошибся ребёнком')$$, 'повторная отмена ничего не ломает');
select is((select status || ':' || cancel_reason from points_ledger where source_id = '00000000-0000-0000-0000-000000000a03'), 'cancelled:Ошибся ребёнком', 'запись осталась со статусом cancelled и причиной');
select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 1, 'Вместо отменённого', '00000000-0000-0000-0000-000000000a05')$$, 'после отмены лимит свободен');

-- общий предел месяца 10: 3 + 2*2 + 3 = 10
select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 2, 'a', gen_random_uuid())$$, '+2 первый раз');
select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 2, 'b', gen_random_uuid())$$, '+2 второй раз');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 4, 'x', gen_random_uuid())$$, '22023', 'points value not allowed', 'значение вне +1/+2/+3 отклоняется');

select lives_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 3, 'Исключительно', gen_random_uuid())$$, '+3 один раз');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 3, 'Ещё', gen_random_uuid())$$, '22023', 'monthly limit reached for this value', 'второе +3 отклоняется');
select is((points_manual_status('00000000-0000-0000-0000-00000000d001') ->> 'month_total')::int, 10, 'за месяц набрано ровно 10, предел достигнут');

-- права
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 3, 'x', gen_random_uuid())$$, '42501', 'forbidden', 'тренер чужой группы не начисляет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select points_manual_award('00000000-0000-0000-0000-00000000d001', 3, 'x', gen_random_uuid())$$, '42501', 'forbidden', 'родитель не начисляет');

select * from finish();
rollback;
