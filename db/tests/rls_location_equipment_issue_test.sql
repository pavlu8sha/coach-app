-- pgTAP: выдача экипировки локальным админом (0108). Своя локация — отметить можно; чужая, снятие выдачи
-- и перезапись — нет; без прав — нет. Глобальный админ по-прежнему ставит и снимает.
begin;
create extension if not exists pgtap;
select plan(10);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9102, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000c2', 9103, 'Тренер', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'Isani', 'Isani'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U13-A', 'Красный парк');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Вика', 'active');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Isani');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'eq1', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Isani', 300);
insert into ids select 'eq3', eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '8', false, 'Красный парк', 300);

-- Гио: заказ своей локации
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select eq_set_issued((select id from ids where k = 'eq1'), 'Форма', true, null, '2026-11-04')$$, 'Гио отмечает выдачу заказа своей локации');
select is((select issued_by from equipment_issues where order_id = (select id from ids where k = 'eq1')), 'Гио', 'кто выдал: имя из профиля, если не введено');
select is((select count(*)::int from equipment_issues), 1, 'Гио читает выдачу только своей локации');
select throws_ok($$select eq_set_issued((select id from ids where k = 'eq3'), 'Форма', true)$$, '42501', null, 'Гио не отмечает выдачу чужой локации');
select throws_ok($$select eq_set_issued((select id from ids where k = 'eq1'), 'Форма', false)$$, '42501', null, 'Гио не снимает выдачу');
select lives_ok($$select eq_set_issued((select id from ids where k = 'eq1'), 'Форма', true, 'Другой', '2026-11-05')$$, 'повторная отметка не падает');
select is((select issued_by from equipment_issues where order_id = (select id from ids where k = 'eq1')), 'Гио', 'повторная отметка ничего не перезаписывает');

-- тренер без прав локации
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select eq_set_issued((select id from ids where k = 'eq1'), 'Форма', true)$$, '42501', null, 'тренер без локации не отмечает выдачу');

-- глобальный админ
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select eq_set_issued((select id from ids where k = 'eq1'), 'Форма', false)$$, 'админ снимает выдачу');
select is((select count(*)::int from equipment_issues), 0, 'выдача снята');

select * from finish();
rollback;
