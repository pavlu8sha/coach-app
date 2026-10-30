-- pgTAP: экипировка для администратора (0036).
begin;
create extension if not exists pgtap;
select plan(17);

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

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, '42501', 'forbidden', 'тренер не создаёт заказы');

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into oid_t select eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма","size":"128","quantity":2},{"kit":"Куртка","size":"128"}]'::jsonb, 'ANYA', '7', true, 'Зал');
select is((select total from equipment_orders where id = (select id from oid_t)), 260::numeric, 'сумма по каталогу: 2×100 + 60');
select is((select count(*)::int from equipment_order_lines where order_id = (select id from oid_t)), 2, 'две позиции');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, '23505', 'number taken', 'номер 7 занят в группе u7 (u7-a и u7-b — одна группа)');
select lives_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '7', false, null)$$, 'в другой группе тот же номер можно');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[{"kit":"Шапка"}]'::jsonb, null, null, false, null)$$, '22023', 'kit not in catalog', 'позиции вне каталога отклоняются');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-00000000d002', '[]'::jsonb, null, null, false, null)$$, '22023', 'no items', 'пустой заказ отклоняется');

select is(eq_add_payment((select id from oid_t), 100, null, 'Наличные'), 100::numeric, 'оплата 100');
select throws_ok($$select eq_add_payment((select id from oid_t), 200, null, 'Наличные')$$, '22023', 'paid above total', 'переплата отклоняется');
select throws_ok($$select eq_add_payment((select id from oid_t), -150, null, 'Наличные')$$, '22023', 'paid below zero', 'оплата не уходит ниже нуля');
select throws_ok($$select eq_edit_order((select id from oid_t), 'ANYA', '7', true, 'Зал', 50)$$, '22023', 'total below paid', 'сумма заказа не ниже оплаченного');

select lives_ok($$select eq_set_issued((select id from oid_t), 'Форма', true, 'Павел')$$, 'отметка о выдаче');
select throws_ok($$select eq_set_issued((select id from oid_t), 'Шапка', true)$$, 'P0002', 'item not in order', 'выдать можно только вещь из заказа');
select throws_ok($$select eq_delete_order((select id from oid_t))$$, '22023', 'order has payments', 'заказ с оплатой удалить нельзя');

select eq_add_payment((select id from oid_t), -100, null, 'Наличные');
select throws_ok($$select eq_delete_order((select id from oid_t))$$, '22023', 'order has issues', 'заказ с выдачей удалить нельзя');
select eq_set_issued((select id from oid_t), 'Форма', false);
select lives_ok($$select eq_delete_order((select id from oid_t))$$, 'без оплат и выдач заказ удаляется');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select eq_catalog_save('Шапка', 20)$$, '42501', 'forbidden', 'родитель не меняет каталог');

select * from finish();
rollback;
