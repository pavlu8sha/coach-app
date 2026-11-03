-- pgTAP: статусы заказов экипировки, история и текст требования к форме (0098, #240).
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9402, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000b2', 9403, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b3', 9404, 'Родитель Вики', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вика', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'o1', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
insert into ids select 'o3', eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '8', false, 'Квартал', 300);

select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'accepted', 'новый заказ: «Принят в заказ»');

-- вперёд только по одному шагу
select lives_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'sewing')$$, 'администратор: принят → пошив');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'issued')$$, '22023', 'bad transition', 'нельзя перескочить через статус');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'sewing')$$, '22023', 'bad transition', 'нельзя поставить тот же статус');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'lost')$$, '22023', 'bad status', 'неизвестный статус отвергается');

-- локальный администратор: только своя локация, только вперёд
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'ready')$$, 'локальный администратор двигает заказ своей локации вперёд');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'sewing')$$, '42501', 'forbidden', 'локальный администратор не возвращает статус назад');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o3'), 'sewing')$$, '42501', 'forbidden', 'заказ чужой локации локальному администратору недоступен');

-- администратор может вернуть на один шаг назад
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'sewing')$$, 'администратор возвращает статус на шаг назад');

-- родитель: читает историю своего ребёнка, не пишет
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'ready')$$, '42501', 'forbidden', 'родитель не меняет статус');
select is((select count(*)::int from equipment_order_status_history), 3, 'родитель видит историю заказа своего ребёнка: 3 записи');
select throws_ok($$insert into equipment_order_status_history (order_id, status) values ((select id from ids where k = 'o1'), 'issued')$$, '42501', null, 'родитель не пишет в историю напрямую');

select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from equipment_order_status_history where order_id = (select id from ids where k = 'o1')), 0, 'история чужого ребёнка родителю не видна');

-- требование к форме: утверждённый текст по умолчанию, затем правка администратором; club_settings родителю закрыта
select ok(equipment_requirement() like '%обязателен для всех воспитанников%', 'по умолчанию отдаётся утверждённый текст');
select ok(equipment_requirement() like E'%единую тренировочную экипировку.\nЕсли у ребёнка%', 'утверждённый текст — две строки');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into club_settings (club_id, key, scope, value, updated_at) values ('00000000-0000-0000-0000-00000000c001', 'equipment.required_text', '', 'Новый текст требования', current_date);
select as_user('00000000-0000-0000-0000-0000000000b2');
select is(equipment_requirement() || '|' || (select count(*)::text from club_settings), 'Новый текст требования|0', 'родитель получает текст администратора, но club_settings читать не может');

select * from finish();
rollback;
