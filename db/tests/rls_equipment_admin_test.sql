-- pgTAP: экипировка для администратора (0036).
begin;
create extension if not exists pgtap;
select plan(26);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8502, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8503, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'u7-a'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'u7-b'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'u9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Вика', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-00000000c001', 'Форма', 100, '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'Куртка', 60, '2026-01-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table oid_t (id uuid);
grant all on oid_t to authenticated;
create temp table oid2_t (id uuid);
grant all on oid2_t to authenticated;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, '42501', 'forbidden', 'тренер не создаёт заказы');

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into oid_t select eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма","size":"128","quantity":2},{"kit":"Куртка","size":"128"}]'::jsonb, 'ANYA', '7', true, 'Зал');
select is((select total from equipment_orders where id = (select id from oid_t)), 260::numeric, 'сумма по каталогу: 2×100 + 60');
select is((select count(*)::int from equipment_order_lines where order_id = (select id from oid_t)), 2, 'две позиции');
select lives_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, 'номер 7 занят в группе u7, но заказ создаётся: номер больше не блокирует (0102)');
select lives_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, 'в другой группе тот же номер можно');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[{"kit":"Шапка"}]'::jsonb, null, null, false, null)$$, '22023', 'kit not in catalog', 'позиции вне каталога отклоняются');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[]'::jsonb, null, null, false, null)$$, '22023', 'no items', 'пустой заказ отклоняется');

select is(eq_add_payment((select id from oid_t), 100, null, 'Наличные'), 100::numeric, 'оплата 100');
select throws_ok($$select eq_add_payment((select id from oid_t), 200, null, 'Наличные')$$, '22023', 'paid above total', 'переплата отклоняется');
select throws_ok($$select eq_add_payment((select id from oid_t), -150, null, 'Наличные')$$, '22023', 'use reversal or refund', 'отрицательная оплата отклоняется: сторно и возврат отдельными функциями (0188)');
select throws_ok($$select eq_edit_order((select id from oid_t), 'ANYA', '7', true, 'Зал', 50)$$, '22023', 'total below paid', 'сумма заказа не ниже оплаченного');

select lives_ok($$select eq_set_issued((select id from oid_t), 'Форма', true, 'Павел')$$, 'отметка о выдаче');
select throws_ok($$select eq_set_issued((select id from oid_t), 'Шапка', true)$$, 'P0002', 'item not in order', 'выдать можно только вещь из заказа');
select throws_ok($$select eq_delete_order((select id from oid_t))$$, '22023', 'order has payments', 'заказ с оплатой удалить нельзя');

select eq_reverse_payment((select id from service_payments where kind = 'equipment' and amount = 100 and ref_id = (select id from oid_t)), 'исправление', null);
select throws_ok($$select eq_delete_order((select id from oid_t))$$, '22023', 'order has issues', 'заказ с выдачей удалить нельзя');
select eq_set_issued((select id from oid_t), 'Форма', false);
select lives_ok($$select eq_delete_order((select id from oid_t))$$, 'без оплат и выдач заказ удаляется');

-- 0125: правка строк заказа
insert into oid2_t select eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма","size":"128"},{"kit":"Куртка","size":"128"}]'::jsonb, null, null, false, null);
select lives_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from oid2_t) and kit = 'Форма'), '134', 1)$$, 'размер строки меняется');
select is((select size from equipment_order_lines where order_id = (select id from oid2_t) and kit = 'Форма'), '134', 'новый размер записан');
select lives_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from oid2_t) and kit = 'Форма'), '134', 2)$$, 'количество меняется, пока не выдано');
select is((select total from equipment_orders where id = (select id from oid2_t)), 260::numeric, 'сумма сдвинулась на цену строки');
select throws_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from oid2_t) and kit = 'Форма'), '134', 11)$$, '22023', 'bad quantity', 'количество от 1 до 10');
select lives_ok($$select eq_add_line((select id from oid2_t), 'Куртка', '140', 1)$$, 'вещь добавляется по цене каталога');
select is((select total from equipment_orders where id = (select id from oid2_t)), 320::numeric, 'сумма выросла на 60');
select eq_set_issued((select id from oid2_t), 'Форма', true, 'Павел');
select throws_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from oid2_t) and kit = 'Форма'), '134', 1)$$, '22023', 'item issued', 'у выданной вещи количество не меняется');
select throws_ok($$select eq_set_order_date((select id from oid2_t), current_date + 1)$$, '22023', 'bad date', 'дата заказа не в будущем');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select eq_catalog_save('Шапка', 20)$$, '42501', 'forbidden', 'родитель не меняет каталог');

select * from finish();
rollback;
