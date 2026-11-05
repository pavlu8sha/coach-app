-- pgTAP: анонимные групповые ориентиры (0125). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 7802, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b2', 7803, 'Родитель другого', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'Большая'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'Малая');
-- Большая: 6 игроков (Аня + 5), Малая: 3 игрока
insert into players (id, club_id, group_id, full_name, status)
  select ('00000000-0000-0000-0000-00000000d0' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000c001',
         case when n <= 6 then '00000000-0000-0000-0000-0000000000e1'::uuid else '00000000-0000-0000-0000-0000000000e2'::uuid end, 'Игрок ' || n, 'active'
    from generate_series(1, 9) n;
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', date '2026-12-01', jsonb_build_object(
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

-- декабрь: Аня 4 (2 + 2), Игрок 2 = 10, остальные в Большой 0; Малая: Игрок 7 = 3
select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'extra', gen_random_uuid(), jsonb_build_array(
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 2, 'components', '{}'::jsonb),
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d002', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 5, 'components', '{}'::jsonb),
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d007', 'group_id', '00000000-0000-0000-0000-0000000000e2', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 3, 'components', '{}'::jsonb)));
select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'extra', gen_random_uuid(), jsonb_build_array(
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-10', 'reason_code', 'attended', 'points', 2, 'components', '{}'::jsonb),
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d002', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-10', 'reason_code', 'attended', 'points', 5, 'components', '{}'::jsonb)));

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') ->> 'personal_total')::int, 4, 'личная сумма за месяц');
select is(points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups' -> 0 ->> 'status', 'ok', 'группа из 6 игроков: ориентиры показаны');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups' -> 0 ->> 'avg')::numeric, 2.3, 'среднее: (4 + 10 + 0 × 4) / 6 = 2.3, нули входят');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups' -> 0 ->> 'max')::int, 10, 'максимум одного игрока группы');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups' -> 0 ->> 'group_name'), 'Большая', 'название группы ребёнка');
select ok(position('d002' in points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15')::text) = 0, 'ID других детей в ответе нет');
select is(points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-11-15') -> 'groups', '[]'::jsonb, 'месяц без начислений: групп нет («Нет данных»)');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-11-15') ->> 'personal_total')::int, 0, 'и личная сумма 0 при пустом списке групп');
select throws_ok($$select points_group_benchmark('00000000-0000-0000-0000-00000000d007', date '2026-12-15')$$, '42501', 'forbidden', 'чужого ребёнка родитель не видит');

-- малая группа (3 игрока) ниже порога: тренер/админ видит статус, но не числа
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(points_group_benchmark('00000000-0000-0000-0000-00000000d007', date '2026-12-15') -> 'groups' -> 0 ->> 'status', 'insufficient', 'группа меньше 5 игроков: недостаточно данных');
select is(points_group_benchmark('00000000-0000-0000-0000-00000000d007', date '2026-12-15') -> 'groups' -> 0 -> 'avg', 'null'::jsonb, 'и среднее не раскрывается');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d007', date '2026-12-15') -> 'groups' -> 0 ->> 'personal')::int, 3, 'личные баллы показываются всегда');

-- ушёл до начала месяца: в среднее не входит. 5 игроков остаётся — порог держится
reset role;
update players set status = 'inactive', ends_on = date '2026-11-20' where id = '00000000-0000-0000-0000-00000000d006';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups' -> 0 ->> 'avg')::numeric, 2.8, 'ушедший до месяца не входит: (4 + 10) / 5 = 2.8');

-- переход в другую группу в середине месяца: разбивка по группам
reset role;
select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'extra', gen_random_uuid(), jsonb_build_array(
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e2', 'event_date', '2026-12-20', 'reason_code', 'attended', 'points', 1, 'components', '{}'::jsonb)));
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(jsonb_array_length(points_group_benchmark('00000000-0000-0000-0000-00000000d001', date '2026-12-15') -> 'groups'), 2, 'в месяце две группы: разбивка по группам');

select * from finish();
rollback;
