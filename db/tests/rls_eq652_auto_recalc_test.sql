-- pgTAP: #652 этап 2b (0208), автоматический пересчёт скидки и восстановление с подтверждением.
-- Условия: docs/acceptance/eq-652-stage2b-auto-recalc-0208-2026-11-19.md (Н1–Н12).
begin;
create extension if not exists pgtap;
select plan(58);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0208_eq_auto_recalc.sql

create or replace function pu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000006723' || lpad(n::text, 2, '0'))::uuid $$;
insert into clubs (id, name) values ('00000000-0000-0000-0000-0000006721c1', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000006721a1', 967211, 'Админ', true),
  ('00000000-0000-0000-0000-0000006721b1', 967212, 'Локальный', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000006721b1', 'Исани');
insert into players (id, club_id, full_name, status)
  select pu(n), '00000000-0000-0000-0000-0000006721c1', 'Игрок ' || n, 'active' from generate_series(1, 20) n;
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000006721c1', 'Игровая форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006721c1', 'Тренировочная форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006721c1', 'Спортивный костюм', 210, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006721c1', 'Дождевик', 110, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006721c1', 'Носки', 20, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_pg() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;
create or replace function oid_(k text) returns uuid language sql stable as $$ select id from ids where k = $1 $$;
create or replace function tt(o uuid) returns text language sql stable as $$ select trim_scale(total)::text from equipment_orders where id = o $$;
create or replace function aa(o uuid) returns text language sql stable as $$ select trim_scale(bundle_adjustment)::text from equipment_orders where id = o $$;
create or replace function stz(p uuid) returns text language sql stable as $$ select state || '/' || reason from equipment_bundle_status where player_id = p $$;
create or replace function inv4() returns int language sql stable as $$
  select count(*)::int from equipment_orders o where o.total <> eq_order_lines_sum(o.id) + o.manual_adjustment + o.bundle_adjustment or o.bundle_adjustment > 0 $$;
create or replace function fp_pay() returns text language sql stable as $$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from service_payments t), '')) || '/' || coalesce((select sum(paid)::text from equipment_orders), '0') $$;
create or replace function snap() returns text language sql stable as $$
  select md5((select coalesce(string_agg(o::text, '|' order by o.id), '') from equipment_orders o) || '#' || (select count(*)::text from equipment_order_events)
             || '#' || (select count(*)::text from equipment_bundle_runs) || '#' || (select coalesce(string_agg(b::text, '|' order by b.id), '') from equipment_bundles b)) $$;
-- заказ через функцию с датой (создание в одной транзакции даёт одинаковый created_at: порядок задают даты заказов)
create or replace function mkc(k text, p uuid, kits text[], d int, inst boolean default false, ct numeric default null) returns void
language plpgsql as $$
declare l jsonb := '[]'::jsonb; x text; o uuid;
begin
  foreach x in array kits loop l := l || jsonb_build_array(jsonb_build_object('kit', x)); end loop;
  o := eq_create_order(p, l, null, null, inst, null, ct);
  insert into ids values (k, o);
  perform eq_set_order_date(o, current_date - d);
end $$;
grant execute on function mkc(text, uuid, text[], int, boolean, numeric) to authenticated;

-- Н2: без отметки freeze_2c функции с автопересчётом не работают, ничего не создаётся
select as_pg();
alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
delete from equipment_bundle_steps where step = 'freeze_2c';
alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;
select as_user('00000000-0000-0000-0000-0000006721a1');
select throws_ok($$select eq_create_order(pu(1), '[{"kit":"Дождевик"}]'::jsonb, null, null, false, null)$$, '55000', 'bundle freeze not applied', 'Н2: создание без отметки заморозки отклоняется');
select as_pg();
select is((select count(*)::int from equipment_orders where player_id = pu(1)), 0, 'Н2: заказ не создан');
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'тест');

-- Н1 (S1): создание О1 и О2, оплата на О1
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p1o1', pu(1), array['Игровая форма', 'Тренировочная форма'], 3);
select eq_add_payment(oid_('p1o1'), 300, null, 'Наличные');
select as_pg();
insert into ids values ('fp0', null);
create temp table fp (k text, v text);
insert into fp values ('pay0', fp_pay());
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p1o2', pu(1), array['Спортивный костюм', 'Дождевик'], 2);
select as_pg();
select is(tt(oid_('p1o2')) || '/' || tt(oid_('p1o1')), '225/300', 'Н1/S1: создание пересчитывает само: О2 225, О1 300');
select is(stz(pu(1)), 'active/ok', 'Н1: состояние ребёнка active/ok');
select is(fp_pay(), (select v from fp where k = 'pay0'), 'И1: платёж и paid не изменились автоматическим пересчётом');
select is((select count(*)::int from equipment_order_events where order_id = oid_('p1o2') and event = 'recalc'), 1, 'Н1: событие пересчёта записано');

-- Н1: правка состава: убрать дождевик, вернуть, количество 2
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_delete_line((select id from equipment_order_lines where order_id = oid_('p1o2') and kit = 'Дождевик'));
select as_pg();
select is(tt(oid_('p1o2')) || '/' || stz(pu(1)), '210/none/not_complete', 'Н1/S22: без дождевика скидки нет (210)');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_add_line(oid_('p1o2'), 'Дождевик', 'M', 1);
select as_pg();
select is(tt(oid_('p1o2')), '225', 'Н1: добавили дождевик: скидка вернулась (225)');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_edit_line((select id from equipment_order_lines where order_id = oid_('p1o2') and kit = 'Дождевик'), 'M', 2);
select as_pg();
select is(tt(oid_('p1o2')), '335', 'Н1/S5: второй дождевик по полной цене: 210+220−95 = 335');
select is(inv4(), 0, 'И4: равенство итога сохраняется после всех операций');

-- Н6: повтор создания с тем же ключом не пересчитывает и не пишет событий
select as_user('00000000-0000-0000-0000-0000006721a1');
insert into ids select 'req1', eq_create_order(pu(2), '[{"kit":"Дождевик"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000672f01');
select as_pg();
insert into fp values ('snap_req', snap());
select as_user('00000000-0000-0000-0000-0000006721a1');
select is(eq_create_order(pu(2), '[{"kit":"Дождевик"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000672f01'), oid_('req1'), 'Н6: повтор возвращает тот же заказ');
select as_pg();
select is(snap(), (select v from fp where k = 'snap_req'), 'Н6: повтор не меняет заказы, события и журнал запусков');

-- Н3: рассрочка
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p3o1', pu(3), array['Игровая форма', 'Тренировочная форма'], 3, true);
select mkc('p3o2', pu(3), array['Спортивный костюм', 'Дождевик'], 2);
select as_pg();
select is((select discount_forfeited from equipment_orders where id = oid_('p3o1')), true, 'Н3: рассрочка при создании ставит отказ');
select is(tt(oid_('p3o2')) || '/' || stz(pu(3)), '320/none/forfeited_order', 'Н3/S7: участвующий заказ в рассрочку: скидки нет');
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p4o1', pu(4), array['Игровая форма', 'Тренировочная форма'], 3);
select mkc('p4o2', pu(4), array['Спортивный костюм', 'Дождевик'], 2);
select as_pg();
select is(tt(oid_('p4o2')), '225', 'Н3: до рассрочки скидка 95');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_edit_order(oid_('p4o2'), null, null, true, null, 225);
select as_pg();
select is(tt(oid_('p4o2')) || '/' || (select discount_forfeited::text from equipment_orders where id = oid_('p4o2')), '320/true', 'Н3/S10: выбор рассрочки у заказа комплекта снимает скидку (F2)');
select is((select count(*)::int from equipment_order_events where order_id = oid_('p4o2') and event = 'forfeit' and reason = 'installment'), 1, 'Н3: событие forfeit');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_edit_order(oid_('p4o2'), null, null, false, null, 320);
select as_pg();
select is(tt(oid_('p4o2')) || '/' || (select discount_forfeited::text from equipment_orders where id = oid_('p4o2')), '320/true', 'Н3/S11: возврат на полную оплату скидку не возвращает, отказ остаётся');
select is(inv4(), 0, 'И4 после рассрочки');

-- Н4: отмена замыкающего и незамыкающего
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p5o1', pu(5), array['Игровая форма', 'Тренировочная форма'], 3);
select mkc('p5o2', pu(5), array['Спортивный костюм', 'Дождевик'], 2);
select eq_add_payment(oid_('p5o2'), 100, null, 'Наличные');
select as_pg();
insert into fp values ('pay5', fp_pay());
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_cancel_order(oid_('p5o2'), 'дубль');
select as_pg();
select is(tt(oid_('p5o2')) || '/' || aa(oid_('p5o2')) || '/' || stz(pu(5)), '320/0/none/not_complete', 'Н4/S14: отмена замыкающего: скидка снята сразу');
select is((select revoked_reason from equipment_bundles where player_id = pu(5)), 'closing_order_cancelled', 'Н4: причина отзыва closing_order_cancelled');
select is(fp_pay(), (select v from fp where k = 'pay5'), 'Н4: платежи не меняются, возврат не создаётся');
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p6o1', pu(6), array['Игровая форма', 'Тренировочная форма'], 3);
select mkc('p6o2', pu(6), array['Спортивный костюм', 'Дождевик'], 2);
select eq_cancel_order(oid_('p6o1'), 'отмена незамыкающего');
select as_pg();
select is(tt(oid_('p6o2')) || '/' || stz(pu(6)), '320/none/not_complete', 'Н4/S15: отмена незамыкающего: скидка снята');

-- Н5: восстановление только с подтверждением
select as_pg();
insert into fp values ('snap_cf', snap());
select as_user('00000000-0000-0000-0000-0000006721a1');
select throws_ok($$select eq_restore_order(oid_('p6o1'), 'вернуть', null::text)$$, '22023', 'confirm required', 'Н5: без подтверждения confirm required');
select throws_ok($$select eq_restore_order(oid_('p6o1'), 'вернуть')$$, '22023', 'confirm required', 'Н5: двухаргументная форма тоже требует подтверждения');
select as_pg();
select is(snap(), (select v from fp where k = 'snap_cf'), 'Н5: отказ ничего не изменил');
select as_user('00000000-0000-0000-0000-0000006721a1');
create temp table pv as select eq_restore_preview(oid_('p6o1')) as j;
select as_pg();
select is(snap(), (select v from fp where k = 'snap_cf'), 'Н5: предпросмотр ничего не пишет');
select ok((select j ? 'orders' and j ? 'overpaid' and j ? 'closing_order_id' and (j->>'discount')::numeric = 95 from pv), 'Н5: предпросмотр: итоги, переплата, замыкающий, скидка 95');
select as_user('00000000-0000-0000-0000-0000006721b1');
select throws_ok($$select eq_restore_preview(oid_('p6o1'))$$, '42501', 'forbidden', 'Н5: предпросмотр не для локального администратора');
select as_user('00000000-0000-0000-0000-0000006721a1');
select throws_ok($$select eq_restore_preview(oid_('p4o2'))$$, '22023', 'not cancelled', 'Н5: предпросмотр только для отменённого заказа');
select eq_restore_order(oid_('p6o1'), 'вернуть', eq_restore_preview(oid_('p6o1'))->>'fingerprint');
select as_pg();
select is(tt(oid_('p6o2')) || '/' || stz(pu(6)), '225/active/ok', 'Н5/S17: после подтверждения скидка вернулась');

-- Н5/S18: отказ восстановленного заказа сохраняется (R3)
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p7o1', pu(7), array['Игровая форма', 'Тренировочная форма'], 3, true);
select mkc('p7o2', pu(7), array['Спортивный костюм', 'Дождевик'], 2);
select eq_cancel_order(oid_('p7o1'), 'тест');
select eq_restore_order(oid_('p7o1'), 'вернуть', eq_restore_preview(oid_('p7o1'))->>'fingerprint');
select as_pg();
select is((select discount_forfeited from equipment_orders where id = oid_('p7o1')) and tt(oid_('p7o2')) = '320', true, 'Н5/S18: восстановленный заказ в рассрочку сохраняет отказ, скидки нет');

-- Н5/S19, S23: скидка переезжает при восстановлении более раннего заказа; оплаченное остаётся, переплата показывается
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p8o1', pu(8), array['Игровая форма', 'Тренировочная форма'], 4);
select eq_cancel_order(oid_('p8o1'), 'тест');
select mkc('p8o2', pu(8), array['Спортивный костюм', 'Дождевик'], 3);
select mkc('p8o3', pu(8), array['Игровая форма', 'Тренировочная форма'], 1);
select eq_add_payment(oid_('p8o2'), 320, null, 'Наличные');
select as_pg();
select is(tt(oid_('p8o3')) || '/' || tt(oid_('p8o2')), '205/320', 'S19: до восстановления скидка на О3');
insert into fp values ('pay8', fp_pay());
select as_user('00000000-0000-0000-0000-0000006721a1');
create temp table pv8 as select eq_restore_preview(oid_('p8o1')) as j;
select as_pg();
select is((select (j->>'closing_order_id') from pv8), oid_('p8o2')::text, 'S19: предпросмотр: замыкающим станет О2, скидка переезжает');
select is((select (j->>'overpaid')::numeric from pv8), 95::numeric, 'S23: предпросмотр показывает переплату 95');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_restore_order(oid_('p8o1'), 'вернуть', eq_restore_preview(oid_('p8o1'))->>'fingerprint');
select as_pg();
select is(tt(oid_('p8o3')) || '/' || tt(oid_('p8o2')) || '/' || (select paid::text from equipment_orders where id = oid_('p8o2')), '300/225/320.00', 'S19/S23: итог О3 300, О2 225, оплачено 320 осталось на О2');
select is(fp_pay(), (select v from fp where k = 'pay8'), 'S23/И1: платежи не перемещаются');
select is((select eq_order_overpaid(e) from equipment_orders e where id = oid_('p8o2')), 95::numeric, 'S23: переплата 95 показывается отдельно');

-- Н7 (Q8): своя сумма записывается как ручная корректировка, скидка комплекта считается поверх
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p9o1', pu(9), array['Игровая форма', 'Тренировочная форма', 'Спортивный костюм', 'Дождевик'], 1, false, 500);
select as_pg();
select is((select trim_scale(manual_adjustment)::text from equipment_orders where id = oid_('p9o1')) || '/' || tt(oid_('p9o1')), '-120/405', 'Н7: своя сумма 500 = корректировка −120; скидка 95 поверх: 405');
select as_user('00000000-0000-0000-0000-0000006721b1');
select throws_ok($$select eq_create_order(pu(9), '[{"kit":"Дождевик"}]'::jsonb, null, null, false, null, 100)$$, '42501', 'forbidden', 'Н7: своя сумма только у глобального администратора');
select as_pg();

-- Н8: ошибка настроек: заказ создаётся без скидки, автопересчёт состояние не снимает
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-0000006721c1', 'equip.discPct', 'abc');
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p10o1', pu(10), array['Игровая форма', 'Тренировочная форма'], 3);
select mkc('p10o2', pu(10), array['Спортивный костюм', 'Дождевик'], 2);
select as_pg();
select is(tt(oid_('p10o2')) || '/' || (select discount_state from equipment_orders where id = oid_('p10o2')) || '/' || stz(pu(10)), '320/unchecked/unchecked/settings_invalid', 'Н8: создание не блокируется: без скидки, метка unchecked');
update club_settings set value = '15' where key = 'equip.discPct';
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_edit_line((select id from equipment_order_lines where order_id = oid_('p10o2') and kit = 'Дождевик'), 'L', 1);
select as_pg();
select is(stz(pu(10)) || '/' || tt(oid_('p10o2')), 'unchecked/settings_invalid/320', 'Н8: автопересчёт состояние unchecked не снимает');
select as_user('00000000-0000-0000-0000-0000006721a1');
select eq_bundle_recalc(pu(10));
select as_pg();
select is(stz(pu(10)) || '/' || tt(oid_('p10o2')), 'active/ok/225', 'Н8: ручной пересчёт снимает после успешной проверки');
delete from club_settings where key = 'equip.discPct';

-- Н9: замороженный комплект автоматикой не трогается
create or replace function mk_frozen(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); lb uuid;
begin
  insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid, created_at) values
    (o1, '00000000-0000-0000-0000-0000006721c1', p, current_date - 9, 0, 0, now() - interval '9 days'),
    (o2, '00000000-0000-0000-0000-0000006721c1', p, current_date - 8, 0, 0, now() - interval '8 days');
  insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values
    (o1, 'Игровая форма', 'M', 1, 150), (o1, 'Тренировочная форма', 'M', 1, 150), (o2, 'Спортивный костюм', 'M', 1, 210), (o2, 'Дождевик', 'M', 1, 110);
  perform set_config('eq.op', 'backfill', true);
  update equipment_orders set total = 300 where id = o1;
  update equipment_orders set total = 225, manual_adjustment = -95 where id = o2;
  perform set_config('eq.op', '', true);
  insert into equipment_legacy_bundles (player_id, kind, reason) values (p, 'confirmed', 'тест') returning id into lb;
  perform set_config('eq.op', 'recalc', true);
  update equipment_orders set legacy_bundle_id = lb where id in (o1, o2);
  perform set_config('eq.op', '', true);
  insert into ids values ('frz1', o1), ('frz2', o2);
end $$;
grant execute on function mk_frozen(uuid) to authenticated;
select as_pg();
select mk_frozen(pu(11));
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p11o3', pu(11), array['Дождевик'], 1);
select eq_set_order_date(oid_('frz1'), current_date - 7);
select as_pg();
select is(tt(oid_('frz1')) || '/' || tt(oid_('frz2')) || '/' || aa(oid_('frz2')) || '/' || tt(oid_('p11o3')), '300/225/0/110', 'Н9/В5: замороженный комплект: вторая скидка не добавлена, новый заказ 110');
select is((select count(*)::int from equipment_bundles where player_id = pu(11)), 0, 'Н9: комплект у замороженного ребёнка не создаётся');

-- Н13: подтверждение привязано к показанному предпросмотру (отпечаток); устаревший предпросмотр отклоняется без изменений
select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p16o1', pu(16), array['Игровая форма', 'Тренировочная форма'], 4);
select eq_cancel_order(oid_('p16o1'), 'тест');
select mkc('p16o2', pu(16), array['Спортивный костюм', 'Дождевик'], 3);
create temp table pv16 as select eq_restore_preview(oid_('p16o1'))->>'fingerprint' as f;
select mkc('p16o3', pu(16), array['Носки'], 1);  -- состав ребёнка изменился между предпросмотром и подтверждением
select as_pg();
insert into fp values ('snap16', snap());
select as_user('00000000-0000-0000-0000-0000006721a1');
select throws_ok($$select eq_restore_order(oid_('p16o1'), 'вернуть', (select f from pv16))$$, '40001', 'preview changed', 'Н13: восстановление со старым предпросмотром отклонено');
select throws_ok($$select eq_restore_order(oid_('p16o1'), 'вернуть', 'abc')$$, '40001', 'preview changed', 'Н13: произвольный отпечаток отклонён');
select as_pg();
select is(snap(), (select v from fp where k = 'snap16'), 'Н13: отказ ничего не изменил (заказ остался отменённым, суммы те же)');
select as_user('00000000-0000-0000-0000-0000006721a1');
select lives_ok($$select eq_restore_order(oid_('p16o1'), 'вернуть', eq_restore_preview(oid_('p16o1'))->>'fingerprint')$$, 'Н13: со свежим предпросмотром восстановление проходит');
select as_pg();
select ok((select status <> 'cancelled' from equipment_orders where id = oid_('p16o1')), 'Н13: заказ восстановлен');

select as_user('00000000-0000-0000-0000-0000006721a1');
select mkc('p17o1', pu(17), array['Игровая форма', 'Тренировочная форма'], 3);
select mkc('p17o2', pu(17), array['Спортивный костюм', 'Дождевик'], 2);
create temp table pv17 as select eq_bundle_preview(pu(17))->>'fingerprint' as f;
select eq_add_payment(oid_('p17o2'), 50, null, 'Наличные');  -- оплата изменилась между предпросмотром и подтверждением
select as_pg();
insert into fp values ('snap17', snap());
select as_user('00000000-0000-0000-0000-0000006721a1');
select throws_ok($$select eq_bundle_recalc(pu(17), 'manual', (select f from pv17))$$, '40001', 'preview changed', 'Н13: ручной пересчёт со старым предпросмотром отклонён');
select throws_ok($$select eq_bundle_recalc(pu(17), 'manual', null)$$, '22023', 'confirm required', 'Н13: пересчёт без отпечатка требует подтверждения');
select as_pg();
select is(snap(), (select v from fp where k = 'snap17'), 'Н13: отказ пересчёта ничего не изменил');
select as_user('00000000-0000-0000-0000-0000006721a1');
select lives_ok($$select eq_bundle_recalc(pu(17), 'manual', eq_bundle_preview(pu(17))->>'fingerprint')$$, 'Н13: со свежим отпечатком пересчёт проходит');
select as_pg();

-- Н10: права при привилегиях Supabase по умолчанию
select ok(not has_function_privilege('anon', 'eq_restore_preview(uuid)', 'execute') and has_function_privilege('authenticated', 'eq_restore_preview(uuid)', 'execute')
  and not has_function_privilege('anon', 'eq_restore_order(uuid,text,text)', 'execute') and has_function_privilege('authenticated', 'eq_restore_order(uuid,text,text)', 'execute') and has_function_privilege('authenticated', 'eq_bundle_recalc(uuid,text,text)', 'execute') and not has_function_privilege('anon', 'eq_bundle_recalc(uuid,text,text)', 'execute'), 'Н10: публичные функции: authenticated да, anon нет');
select ok(not has_function_privilege('authenticated', 'eq_bundle_auto(uuid,text)', 'execute') and not has_function_privilege('anon', 'eq_bundle_auto(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'eq_bundle_run(uuid,text,boolean,text,uuid)', 'execute') and not has_function_privilege('authenticated', 'eq_bundle_run(uuid,text,boolean,text,uuid,text)', 'execute') and not has_function_privilege('authenticated', 'eq_bundle_run(uuid,text,boolean,text)', 'execute')
  and not has_function_privilege('authenticated', 'eq_lock_player_of_order(uuid)', 'execute') and not has_function_privilege('authenticated', 'eq_forfeit_mark(uuid,text)', 'execute'), 'Н10: внутренние функции закрыты');
select ok(not has_function_privilege('anon', 'eq_create_order(uuid,jsonb,text,text,boolean,text,numeric,uuid)', 'execute') and not has_function_privilege('anon', 'eq_cancel_order(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'eq_edit_line(uuid,text,integer)', 'execute') and not has_function_privilege('anon', 'eq_delete_order(uuid)', 'execute'), 'Н10: пересозданные функции для anon закрыты');
select is(inv4(), 0, 'И4: равенство итога у всех заказов теста');

select * from finish();
rollback;
