-- pgTAP: серии посещаемости и бонусы (0124). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(20);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 7702, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b2', 7703, 'Родитель Бори', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'G2'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'G3');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Глеб', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Дима', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', date '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array(
    jsonb_build_object('count', 6, 'bonus', 1), jsonb_build_object('count', 12, 'bonus', 2),
    jsonb_build_object('count', 24, 'bonus', 4), jsonb_build_object('count', 48, 'bonus', 8))),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 13 обычных занятий G1: 02..14 декабря. Постоянное имя сессии = sNN
create temp table s1 as
  select n, gen_random_uuid() as id from generate_series(1, 13) n;
insert into sessions (id, group_id, starts_at, kind, class)
  select id, '00000000-0000-0000-0000-0000000000e1', ((date '2026-12-01' + n) + time '10:00') at time zone 'Asia/Tbilisi', 'training', 'regular' from s1;
-- G2: 3 занятия после перехода Веры
create temp table s2 as select n, gen_random_uuid() as id from generate_series(1, 3) n;
insert into sessions (id, group_id, starts_at, kind, class)
  select id, '00000000-0000-0000-0000-0000000000e2', ((date '2026-12-20' + n) + time '10:00') at time zone 'Asia/Tbilisi', 'training', 'regular' from s2;
-- G3: 5 обычных и одно перенесённое
create temp table s3 as select n, gen_random_uuid() as id from generate_series(1, 6) n;
insert into sessions (id, group_id, starts_at, kind, class)
  select id, '00000000-0000-0000-0000-0000000000e3', ((date '2026-12-01' + n) + time '15:00') at time zone 'Asia/Tbilisi', 'training', case when n = 3 then 'moved' else 'regular' end from s3;
-- занятия до вступления правил (ноябрь): 7 штук
create temp table s0 as select n, gen_random_uuid() as id from generate_series(1, 7) n;
insert into sessions (id, group_id, starts_at, kind, class)
  select id, '00000000-0000-0000-0000-0000000000e3', ((date '2026-11-10' + n) + time '15:00') at time zone 'Asia/Tbilisi', 'training', 'regular' from s0;
grant select on s1, s2, s3, s0 to authenticated;
set constraints all immediate;

-- Аня: 13 «Был» подряд
insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d001', 'present' from s1;
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status = 'active'), 2, 'Аня: два рубежа (6 и 12)');
select is((select sum(points)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status = 'active'), 3, 'бонусы суммируются: 1 + 2');
select is((select event_date from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and points = 1 and source_type = 'series_bonus' and status = 'active'), date '2026-12-07', 'бонус за 6 даётся в день шестой тренировки');

-- Боря: 5 подряд, пропуск, затем 6 подряд
insert into attendance (session_id, player_id, status)
  select id, '00000000-0000-0000-0000-00000000d002', case when n = 6 then 'excused' else 'present' end from s1 where n <= 12;
select is((select sum(points)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and source_type = 'series_bonus' and status = 'active'), 1, 'Боря: пропуск обнулил серию, бонус только за вторую серию');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and source_type = 'series_bonus' and status = 'active' and event_date = date '2026-12-13'), 1, 'вторая серия дошла до 6 на 12-м занятии (13 декабря)');

-- Вера: 4 занятия в G1, затем переход в G2 и 3 занятия там
insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d003', 'present' from s1 where n <= 4;
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d003';
insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d003', 'present' from s2;

-- Глеб: 5 обычных и одно перенесённое занятие; Дима: 7 занятий до вступления правил
insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d004', 'present' from s3;
insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d005', 'present' from s0;
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d004' and source_type = 'series_bonus'), 0, 'перенесённое занятие в серию не входит: бонуса нет');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d005' and source_type = 'series_bonus'), 0, 'занятия до вступления правил не считаются');

-- Информация о серии
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((points_series_info('00000000-0000-0000-0000-00000000d001') ->> 'current')::int, 13, 'Аня: текущая серия 13');
select is((points_series_info('00000000-0000-0000-0000-00000000d001') ->> 'next_threshold')::int, 24, 'следующий рубеж 24');
select is((points_series_info('00000000-0000-0000-0000-00000000d001') ->> 'remaining')::int, 11, 'до рубежа 11 занятий');
select throws_ok($$select points_series_info('00000000-0000-0000-0000-00000000d002')$$, '42501', 'forbidden', 'чужого ребёнка родитель не видит');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((points_series_info('00000000-0000-0000-0000-00000000d002') ->> 'record')::int, 6, 'Боря: рекорд 6 (вторая серия длиннее первой)');
select is((points_series_info('00000000-0000-0000-0000-00000000d002') ->> 'current')::int, 6, 'Боря: текущая серия 6');
select is(jsonb_array_length(points_series_info('00000000-0000-0000-0000-00000000d002') -> 'finished_runs'), 1, 'Боря: одна завершённая серия в истории');
select is((points_series_info('00000000-0000-0000-0000-00000000d003') ->> 'current')::int, 3, 'Вера: после перехода серия началась заново');
select is((points_series_info('00000000-0000-0000-0000-00000000d003') ->> 'record')::int, 4, 'Вера: рекорд прежней группы сохранён');
reset role;

-- исправление отметки задним числом: у Ани третье занятие стало пропуском
update attendance set status = 'absent' where player_id = '00000000-0000-0000-0000-00000000d001' and session_id = (select id from s1 where n = 3);
select is((select sum(points)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status = 'active'), 1, 'после исправления остался один бонус (новая серия 4..13 = 10)');
select ok((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status <> 'active') >= 2, 'прежние бонусы закрыты, а не удалены');
update attendance set status = 'present' where player_id = '00000000-0000-0000-0000-00000000d001' and session_id = (select id from s1 where n = 3);
select is((select sum(points)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status = 'active'), 3, 'возврат отметки восстанавливает бонусы');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d001' and source_type = 'series_bonus' and status = 'active'), 2, 'и без дублей');

select * from finish();
rollback;
