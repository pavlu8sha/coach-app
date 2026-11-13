-- pgTAP: #471 PR-1 (0185), отмена и восстановление заказа экипировки администратором и защита отменённого заказа.
-- Условия: docs/acceptance/eq-471-pr1-foundation-2026-11-12.md (Ф3, Ф5, Ф6, Ф10).
begin;
create extension if not exists pgtap;
select plan(38);

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000004712c1', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000004712a1', 947201, 'Админ', true),
  ('00000000-0000-0000-0000-0000004712b1', 947202, 'Гио', false),
  ('00000000-0000-0000-0000-0000004712b2', 947203, 'Родитель', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-0000004712d1', '00000000-0000-0000-0000-0000004712c1', 'Аня', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-0000004712d1', '00000000-0000-0000-0000-0000004712b2', 'v', now());
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000004712b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000004712c1', 'Форма', 300, '2026-09-01'),
  ('00000000-0000-0000-0000-0000004712c1', 'Костюм', 150, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;
create temp view o1 as select o.* from equipment_orders o where o.id = (select id from ids where k = 'o1');
grant select on o1 to authenticated;

select as_user('00000000-0000-0000-0000-0000004712a1');
insert into ids select 'o1', eq_create_order('00000000-0000-0000-0000-0000004712d1', '[{"kit":"Форма"},{"kit":"Костюм"}]'::jsonb, 'Аня', '5', false, 'Исани', 450);
select eq_add_payment((select id from ids where k = 'o1'), 200, null, 'Наличные');
select eq_set_order_status((select id from ids where k = 'o1'), 'sewing');
select eq_set_issued((select id from ids where k = 'o1'), 'Форма', true);
create temp table pay_before as select id, amount, ref_id from service_payments;
grant select on pay_before to authenticated;

-- Ф10: права на отмену
select as_user('00000000-0000-0000-0000-0000004712b1');
select throws_ok($$select eq_cancel_order((select id from ids where k = 'o1'), 'x')$$, '42501', 'forbidden', 'Ф10: локальный админ не отменяет');
select as_user('00000000-0000-0000-0000-0000004712b2');
select throws_ok($$select eq_cancel_order((select id from ids where k = 'o1'), 'x')$$, '42501', 'forbidden', 'Ф10: родитель не отменяет (самоотмена «Нового» появится в PR-6)');
reset role;
select ok(not has_function_privilege('anon', 'eq_cancel_order(uuid,text)', 'execute'), 'Ф10: anon не вызывает eq_cancel_order');
select ok(not has_function_privilege('anon', 'eq_restore_order(uuid,text)', 'execute'), 'Ф10: anon не вызывает eq_restore_order');

-- Ф3: прямой перевод в cancelled закрыт даже владельцу
select throws_ok($$update equipment_orders set status = 'cancelled', cancelled_at = now(), status_before_cancel = 'sewing' where id = (select id from ids where k = 'o1')$$,
  '42501', 'use eq_cancel_order / eq_restore_order', 'Ф3: прямой перевод в «Отменён» отклоняется');

-- Ф5: отмена
select as_user('00000000-0000-0000-0000-0000004712a1');
select throws_ok($$select eq_cancel_order((select id from ids where k = 'o1'), '  ')$$, '22023', 'reason required', 'Ф5: причина обязательна');
select lives_ok($$select eq_cancel_order((select id from ids where k = 'o1'), 'семья переехала')$$, 'Ф5: администратор отменяет заказ на этапе пошива');
select is((select status || '/' || status_before_cancel || '/' || cancel_reason from o1), 'cancelled/sewing/семья переехала', 'Ф5: статус, статус до отмены и причина сохранены');
select is((select cancelled_by from o1), '00000000-0000-0000-0000-0000004712a1'::uuid, 'Ф5: кто отменил');
select is((select total || '/' || paid from o1), '450.00/200.00', 'Ф5: итог и оплачено не меняются');
select set_eq($$select id::text || amount from service_payments$$, $$select id::text || amount from pay_before$$, 'Ф5: журнал оплат не меняется, возвратов нет');
select is((select count(*)::int from equipment_issues where order_id = (select id from ids where k = 'o1')), 1, 'Ф5: отметка выдачи остаётся');
select is((select status from equipment_order_status_history where order_id = (select id from ids where k = 'o1') order by id desc limit 1), 'cancelled', 'Ф5: строка истории статусов');
select is((select data->>'from_status' || '>' || (data->>'to_status') || ' paid ' || (data->>'paid') || ' total ' || (data->>'total') from equipment_order_events where order_id = (select id from ids where k = 'o1') and event = 'cancel'),
  'sewing>cancelled paid 200.00 total 450.00', 'Ф5: событие отмены «было/стало» с суммами');
select throws_ok($$select eq_cancel_order((select id from ids where k = 'o1'), 'ещё раз')$$, '22023', 'already cancelled', 'Ф5: повторная отмена отклоняется');

-- Ф3: отменённый заказ заморожен
select throws_ok($$select eq_add_payment((select id from ids where k = 'o1'), 50, null, 'Наличные')$$, '22023', 'order cancelled', 'Ф3: оплата на отменённый заказ отклоняется');
select throws_ok($$select eq_add_line((select id from ids where k = 'o1'), 'Костюм', '140', 1)$$, '22023', 'order cancelled', 'Ф3: вещь не добавляется');
select throws_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from ids where k = 'o1') and kit = 'Костюм'), '152', 2)$$, '22023', 'order cancelled', 'Ф3: строка не правится');
select throws_ok($$select eq_delete_line((select id from equipment_order_lines where order_id = (select id from ids where k = 'o1') and kit = 'Костюм'))$$, '22023', 'order cancelled', 'Ф3: строка не удаляется');
select throws_ok($$select eq_set_issued((select id from ids where k = 'o1'), 'Костюм', true)$$, '22023', 'order cancelled', 'Ф3: выдача не отмечается');
select throws_ok($$select eq_set_issued((select id from ids where k = 'o1'), 'Форма', false)$$, '22023', 'order cancelled', 'Ф3: выдача не снимается');
select throws_ok($$select eq_edit_order((select id from ids where k = 'o1'), 'Аня', '5', true, 'Исани', 450)$$, '22023', 'order cancelled', 'Ф3: способ оплаты и итог не меняются');
select throws_ok($$select eq_set_order_date((select id from ids where k = 'o1'), '2026-10-01')$$, '22023', 'order cancelled', 'Ф3: дата не меняется');
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'ready')$$, '22023', 'order cancelled', 'Ф2: отменённый заказ не двигается по статусам');
reset role;
select throws_ok($$update equipment_orders set paid = paid + 1 where id = (select id from ids where k = 'o1')$$, '22023', 'order cancelled', 'Ф3: paid отменённого не растёт даже у владельца');
select is(eq_fix_issued_statuses(), 0, 'Ф3: исправление статусов по выдаче не трогает отменённый');
select is((select status from o1), 'cancelled', 'Ф3: статус остался «Отменён»');

-- Ф6: восстановление
select as_user('00000000-0000-0000-0000-0000004712b1');
select throws_ok($$select eq_restore_order((select id from ids where k = 'o1'), null)$$, '42501', 'forbidden', 'Ф6: локальный админ не восстанавливает (F1)');
select as_user('00000000-0000-0000-0000-0000004712a1');
select lives_ok($$select eq_restore_order((select id from ids where k = 'o1'), 'вернулись')$$, 'Ф6: администратор восстанавливает');
select is((select status from o1), 'sewing', 'Ф6: статус вернулся к прежнему (F1)');
select ok((select cancelled_at is null and status_before_cancel is null and cancel_reason is null and restored_by = '00000000-0000-0000-0000-0000004712a1' from o1), 'Ф6: поля отмены очищены, кто восстановил записано');
select is((select total || '/' || paid from o1), '450.00/200.00', 'Ф6: суммы не меняются');
select set_eq($$select id::text || amount from service_payments$$, $$select id::text || amount from pay_before$$, 'Ф6: журнал оплат не меняется');
select is((select string_agg(event, ',' order by id) from equipment_order_events where order_id = (select id from ids where k = 'o1')), 'cancel,restore', 'Ф6: события отмены и восстановления');
select throws_ok($$select eq_restore_order((select id from ids where k = 'o1'), null)$$, '22023', 'not cancelled', 'Ф6: восстановить неотменённый нельзя');
select lives_ok($$select eq_set_issued((select id from ids where k = 'o1'), 'Костюм', true)$$, 'Ф6: после восстановления заказ снова живой (выдача)');
select is((select status from o1), 'issued', 'Ф6: автостатус по выдаче снова работает');
select lives_ok($$select eq_cancel_order((select id from ids where k = 'o1'), 'вторая отмена')$$, 'Ф6: повторная отмена после восстановления');

select * from finish();
rollback;
