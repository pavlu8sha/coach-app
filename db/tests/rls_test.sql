-- pgTAP: доступ по ролям. Запуск: psql -f db/migrations/0001_init.sql -f db/migrations/0002_rls.sql -f db/tests/rls_test.sql
begin;
create extension if not exists pgtap;
select plan(8);

-- Фикстуры (от владельца БД, RLS не действует). Все UUID — корректный hex.
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 1001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 1002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 1003, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 1004, 'Родитель Б', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Ребёнок Б');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into rules (id, club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Пришёл на тренировку', '2026-09-01');
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f1', 1, 'session', '2026-10-01', 'Пришёл на тренировку'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000f1', 1, 'session', '2026-10-01', 'Пришёл на тренировку');

-- Переход в роль приложения с JWT конкретного пользователя
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. Родитель A видит только своего ребёнка
select as_user('00000000-0000-0000-0000-0000000000b1');
select results_eq(
  $$select id from players order by id$$,
  $$values ('00000000-0000-0000-0000-00000000d001'::uuid)$$,
  'родитель A видит только своего ребёнка'
);

-- 2. Родитель A видит баллы только своего ребёнка
select is((select count(*)::int from point_events), 1, 'родитель A видит баллы только своего ребёнка');

-- 3. Тренер видит только игроков своей группы
select as_user('00000000-0000-0000-0000-0000000000c1');
select results_eq(
  $$select id from players order by id$$,
  $$values ('00000000-0000-0000-0000-00000000d001'::uuid)$$,
  'тренер видит игроков только своей группы'
);

-- 4. Родитель Б не видит ребёнка другой семьи
select as_user('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*)::int from players where id = '00000000-0000-0000-0000-00000000d001'),
  0,
  'родитель Б не видит ребёнка другой семьи'
);

-- 5. Администратор видит всех
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from players), 2, 'администратор видит всех игроков');

-- 6. Журнал баллов нельзя изменить из приложения: update запрещён правами (42501)
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$update point_events set points = 99$$,
  '42501',
  null,
  'журнал баллов нельзя изменить из приложения (update запрещён правами)'
);
reset role;
select is(
  (select points from point_events where player_id = '00000000-0000-0000-0000-00000000d001'),
  1,
  'баллы не изменились'
);

-- 7. Групповой рейтинг: сумма группы, без имён
select as_user('00000000-0000-0000-0000-0000000000b2');
select results_eq(
  $$select group_id, total_points from group_rating('00000000-0000-0000-0000-0000000000e1')$$,
  $$values ('00000000-0000-0000-0000-0000000000e1'::uuid, 1::bigint)$$,
  'групповой рейтинг возвращает сумму группы'
);

-- 8. У функции группового рейтинга нет колонок с персональными данными
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'group_rating' and column_name in ('full_name', 'birth_date')
  ),
  'групповой рейтинг не содержит имён и дат рождения'
);

select * from finish();
rollback;
