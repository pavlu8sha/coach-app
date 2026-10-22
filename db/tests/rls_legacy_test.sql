-- pgTAP: доступ к таблицам из 0003 (платежи, экипировка, пробные). Запуск после 0001–0004.
begin;
create extension if not exists pgtap;
set local search_path = public, extensions;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Клуб 2');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a2', 2001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b3', 2002, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b4', 2003, 'Родитель Б', false),
  ('00000000-0000-0000-0000-0000000000c2', 2004, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e3');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000e3', 'Ребёнок А2');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-0000000000b3', 'v1', now());
insert into payments (player_id, amount, paid_on) values
  ('00000000-0000-0000-0000-00000000d103', 165, '2026-10-01');
insert into trials (club_id, full_name, phone) values
  ('00000000-0000-0000-0000-00000000c002', 'Пробный Пётр', '+995 555 000 000');
insert into equipment_orders (club_id, player_id, ordered_on, total) values
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000d103', '2026-10-01', 100);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. Родитель видит платёж своего ребёнка
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from payments), 1, 'родитель видит платежи своего ребёнка');

-- 2. Другой родитель платежи не видит
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from payments), 0, 'другой родитель не видит чужие платежи');

-- 3. Тренер платежи не видит
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from payments), 0, 'тренер не видит платежи');

-- 4. Пробные — только администратору
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from trials), 0, 'тренер не видит пробных');
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from trials), 1, 'администратор видит пробных');

-- 5. Экипировка: родитель видит заказ своего ребёнка, другой — нет
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from equipment_orders), 0, 'другой родитель не видит заказ экипировки');

select * from finish();
rollback;
