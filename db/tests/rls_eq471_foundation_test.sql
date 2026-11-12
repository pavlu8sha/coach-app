-- pgTAP: #471 PR-1 (0185), основа заказа экипировки: колонки, статусы new/cancelled, журнал событий, к оплате и переплата,
-- учёт отменённых в parent_dues и номерах. Условия: docs/acceptance/eq-471-pr1-foundation-2026-11-12.md (Ф1, Ф2, Ф4, Ф7–Ф10).
begin;
create extension if not exists pgtap;
select plan(51);

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000004711c1', 'Клуб');
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000004711e1', '00000000-0000-0000-0000-0000004711c1', 'u9', 'Исани');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000004711a1', 947101, 'Админ', true),
  ('00000000-0000-0000-0000-0000004711b1', 947102, 'Гио', false),
  ('00000000-0000-0000-0000-0000004711b2', 947103, 'Родитель', false),
  ('00000000-0000-0000-0000-0000004711b3', 947104, 'Тренер', false);
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-0000004711d1', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-0000004711d2', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711e1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-0000004711d1', '00000000-0000-0000-0000-0000004711b2', 'v', now());
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000004711b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-0000004711c1', 'Форма', 300, '2026-09-01');
insert into club_settings (club_id, key, scope, value) values ('00000000-0000-0000-0000-0000004711c1', 'parent_debt_enabled', '', 'true');

-- Ф1: структура
select has_column('equipment_orders', c, 'Ф1: колонка ' || c) from unnest(array['created_at', 'created_by', 'source', 'request_id',
  'cancelled_at', 'cancelled_by', 'cancel_reason', 'status_before_cancel', 'restored_at', 'restored_by']) c;
select col_not_null('equipment_orders', 'created_at', 'Ф1: created_at обязательна');
select col_not_null('equipment_orders', 'source', 'Ф1: source обязательна');
select col_default_is('equipment_orders', 'source', 'admin', 'Ф1: source по умолчанию admin');

-- Ф1: старые заказы (вставка напрямую владельцем, как при импорте)
insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid, location, external_ord_id) values
  ('00000000-0000-0000-0000-000000471101', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d1', '2026-09-10', 300, 100, 'Исани', 'X-1');
insert into equipment_order_lines (order_id, kit, quantity, unit_price) values ('00000000-0000-0000-0000-000000471101', 'Форма', 1, 300);
select is((select source from equipment_orders where id = '00000000-0000-0000-0000-000000471101'), 'import', 'Ф1: заказ с external_ord_id получает source import');
select is((select status from equipment_orders where id = '00000000-0000-0000-0000-000000471101'), 'accepted', 'Ф1: по умолчанию статус прежний (accepted)');

-- Ф1: новый заказ админа через функцию: created_by = автор, source admin; клиентский created_by не принимается
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000004711a1');
insert into ids select 'o2', eq_create_order('00000000-0000-0000-0000-0000004711d1', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
select is((select created_by from equipment_orders where id = (select id from ids where k = 'o2')), '00000000-0000-0000-0000-0000004711a1'::uuid, 'Ф1: created_by = вошедший администратор');
select is((select source from equipment_orders where id = (select id from ids where k = 'o2')), 'admin', 'Ф1: заказ администратора source admin');
select ok((select created_at > now() - interval '1 minute' from equipment_orders where id = (select id from ids where k = 'o2')), 'Ф1: created_at нового заказа = сейчас');
insert into equipment_orders (id, club_id, player_id, total, created_by, request_id) values
  ('00000000-0000-0000-0000-000000471103', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 50, '00000000-0000-0000-0000-0000004711b2', '00000000-0000-0000-0000-00000047a001');
select is((select created_by from equipment_orders where id = '00000000-0000-0000-0000-000000471103'), '00000000-0000-0000-0000-0000004711a1'::uuid, 'Ф1: подставленный created_by заменяется вошедшим');
select throws_ok($$insert into equipment_orders (club_id, player_id, total, request_id) values ('00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 50, '00000000-0000-0000-0000-00000047a001')$$,
  '23505', null, 'Ф1: повтор request_id того же автора отклоняется');
select throws_ok($$update equipment_orders set created_by = '00000000-0000-0000-0000-0000004711b2' where id = '00000000-0000-0000-0000-000000471103'$$,
  '42501', 'created fields are immutable', 'Ф1: автор и время создания не меняются');
reset role;

-- Ф2: статусы в CHECK
select lives_ok($$insert into equipment_orders (id, club_id, player_id, total, status) values ('00000000-0000-0000-0000-000000471104', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 120, 'new')$$, 'Ф2: статус new допустим');
select throws_ok($$insert into equipment_orders (club_id, player_id, total, status) values ('00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 1, 'lost')$$, '23514', null, 'Ф2: неизвестный статус отклоняется');
select throws_ok($$insert into equipment_orders (club_id, player_id, total, status) values ('00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 1, 'cancelled')$$, '42501', null, 'Ф3: сразу создать отменённый заказ нельзя');
select lives_ok($$insert into equipment_order_status_history (order_id, status) values ('00000000-0000-0000-0000-000000471104', 'new'), ('00000000-0000-0000-0000-000000471104', 'cancelled')$$, 'Ф2: история принимает new и cancelled');
insert into equipment_order_lines (order_id, kit, quantity, unit_price) values ('00000000-0000-0000-0000-000000471104', 'Форма', 1, 120);

-- Ф2: шаги new → accepted (локальный админ своей локации, заказ без локации только админ), назад в new нельзя
update equipment_orders set location = 'Исани' where id = '00000000-0000-0000-0000-000000471104';
select as_user('00000000-0000-0000-0000-0000004711b1');
select lives_ok($$select eq_set_order_status('00000000-0000-0000-0000-000000471104', 'accepted')$$, 'Ф2: локальный админ принимает новый заказ своей локации');
select as_user('00000000-0000-0000-0000-0000004711a1');
select throws_ok($$select eq_set_order_status('00000000-0000-0000-0000-000000471104', 'new')$$, '22023', 'bad transition', 'Ф2: вернуть в «Новый» нельзя даже админу');
select throws_ok($$select eq_set_order_status('00000000-0000-0000-0000-000000471104', 'cancelled')$$, '22023', 'bad status', 'Ф2: отмена не через смену статуса');

-- Ф8: к оплате и переплата
select is((select eq_order_due(o) from equipment_orders o where id = '00000000-0000-0000-0000-000000471101'), 200.00::numeric, 'Ф8: к оплате = итог − оплачено');
select is((select eq_order_overpaid(o) from equipment_orders o where id = '00000000-0000-0000-0000-000000471101'), 0.00::numeric, 'Ф8: переплаты нет');
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'eq_order_due(equipment_orders)'::regprocedure), 'Ф8: eq_order_due с правами вызывающего');
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'eq_order_overpaid(equipment_orders)'::regprocedure), 'Ф8: eq_order_overpaid с правами вызывающего');
select lives_ok($$select eq_cancel_order('00000000-0000-0000-0000-000000471101', 'передумали')$$, 'Ф5: админ отменяет заказ с оплатой');
select is((select eq_order_due(o) from equipment_orders o where id = '00000000-0000-0000-0000-000000471101'), 0::numeric, 'Ф8: у отменённого к оплате 0');
select is((select eq_order_overpaid(o) from equipment_orders o where id = '00000000-0000-0000-0000-000000471101'), 100.00::numeric, 'Ф8: у отменённого переплата = оплачено');

-- Ф4: журнал событий
select is((select count(*)::int from equipment_order_events where order_id = '00000000-0000-0000-0000-000000471101' and event = 'cancel'), 1, 'Ф4: событие отмены записано');
select throws_ok($$update equipment_order_events set reason = 'x'$$, '42501', null, 'Ф4: событие не правится (админ)');
reset role;
select throws_ok($$update equipment_order_events set reason = 'x'$$, '42501', 'equipment_order_events is append-only', 'Ф4: событие не правится даже владельцем');
select throws_ok($$delete from equipment_order_events$$, '42501', 'equipment_order_events is append-only', 'Ф4: событие не удаляется');
select throws_ok($$truncate equipment_order_events$$, '42501', 'equipment_order_events is append-only', 'Ф4: журнал не очищается');
select as_user('00000000-0000-0000-0000-0000004711b1');
select is((select count(*)::int from equipment_order_events), 1, 'Ф4: локальный админ видит события заказов своей локации');
select throws_ok($$insert into equipment_order_events (order_id, event) values ('00000000-0000-0000-0000-000000471101', 'cancel')$$, '42501', null, 'Ф4: прямая запись закрыта');
select as_user('00000000-0000-0000-0000-0000004711b2');
select is((select count(*)::int from equipment_order_events), 0, 'Ф4: родитель журнал не читает');

-- Ф9: parent_dues: отменённый с оплатой виден с подписью, долг 0; новый заказ ребёнка учитывается обычно
select is((select string_agg(title || ' / ' || due || ' / ' || paid || ' / ' || debt, '; ' order by title) from parent_dues() where kind = 'eq'),
  'Отменён: Форма / 0 / 100.00 / 0; Форма / 300.00 / 0.00 / 300.00', 'Ф9: отменённый заказ с оплатой показан с подписью, к оплате и долг 0');
reset role;
update equipment_orders set paid = 0 where id = '00000000-0000-0000-0000-000000471101';
select as_user('00000000-0000-0000-0000-0000004711b2');
select is((select count(*)::int from parent_dues() where kind = 'eq'), 1, 'Ф9: отменённый заказ без оплат родителю не показывается');
reset role;

-- Ф9: номер на отменённом заказе не занят
select as_user('00000000-0000-0000-0000-0000004711a1');
insert into ids select 'o5', eq_create_order('00000000-0000-0000-0000-0000004711d2', '[{"kit":"Форма"}]'::jsonb, null, '11', false, 'Исани', 300);
reset role;
select ok(eq_number_taken(null, '00000000-0000-0000-0000-0000004711d1', '11'), 'Ф9: номер действующего заказа занят');
select as_user('00000000-0000-0000-0000-0000004711a1');
select lives_ok($$select eq_cancel_order((select id from ids where k = 'o5'), 'ошибка')$$, 'Ф5: отмена заказа с номером');
reset role;
select ok(not eq_number_taken(null, '00000000-0000-0000-0000-0000004711d1', '11'), 'Ф9: номер отменённого заказа свободен');

-- Ф7: удаление
select as_user('00000000-0000-0000-0000-0000004711a1');
select throws_ok($$select eq_delete_order((select id from ids where k = 'o5'))$$, '22023', 'order has events', 'Ф7: заказ с событиями (отменённый) не удаляется');
reset role;
insert into equipment_orders (id, club_id, player_id, total, source) values ('00000000-0000-0000-0000-000000471105', '00000000-0000-0000-0000-0000004711c1', '00000000-0000-0000-0000-0000004711d2', 50, 'parent');
select throws_ok($$update equipment_orders set source = 'admin' where id = '00000000-0000-0000-0000-000000471105'$$, '42501', 'created fields are immutable', 'Ф1: источник заказа не меняется (родительский не превратить в админский)');
select as_user('00000000-0000-0000-0000-0000004711a1');
select throws_ok($$select eq_delete_order('00000000-0000-0000-0000-000000471105')$$, '22023', 'parent order', 'Ф7: заказ родителя не удаляется');

select * from finish();
rollback;
