-- pgTAP: #652 этап 2a (0205), модель и серверный расчёт скидки за комплект.
-- Условия: docs/acceptance/eq-652-stage2-bundle-discount-2026-11-16.md (А1–А14, И1–И7).
begin;
create extension if not exists pgtap;
select plan(107);

-- Права проверяются на базе с привилегиями по умолчанию Supabase (И7): новые функции получают их автоматически.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0205_eq_bundle_model.sql

create or replace function u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000065' || lpad(n::text, 4, '0'))::uuid $$;
create or replace function pu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000006523' || lpad(n::text, 2, '0'))::uuid $$;

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000006521c1', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000006521a1', 965211, 'Админ', true),
  ('00000000-0000-0000-0000-0000006521b1', 965212, 'Локальный', false),
  ('00000000-0000-0000-0000-0000006521b2', 965213, 'Родитель', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000006521b1', 'Исани');
insert into players (id, club_id, full_name, status)
  select pu(n), '00000000-0000-0000-0000-0000006521c1', 'Игрок ' || n, 'active' from generate_series(1, 30) n;
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000006521c1', 'Игровая форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006521c1', 'Тренировочная форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006521c1', 'Спортивный костюм', 210, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006521c1', 'Дождевик', 110, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006521c1', 'Носки', 20, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_pg() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- Заказ напрямую (как данные из импорта): время создания задаётся, заказ создаётся без пользователя.
create or replace function mk_order(oid uuid, pid uuid, ts timestamptz, od date, forf boolean, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid, created_at, discount_forfeited)
  values (oid, '00000000-0000-0000-0000-0000006521c1', pid, od, forf, 0, 0, ts, forf);
  for i in select * from jsonb_array_elements(items) loop
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, i->>'kit', 'M', coalesce((i->>'qty')::int, 1), (i->>'price')::numeric);
  end loop;
  update equipment_orders set total = eq_order_lines_sum(oid) where id = oid;
end $$;
create or replace function freeze(oid uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lb uuid;
begin
  insert into equipment_legacy_bundles (player_id, kind, reason) values (pid, 'confirmed', 'тест') returning id into lb;
  perform set_config('eq.op', 'recalc', true);
  update equipment_orders set legacy_bundle_id = lb where id = oid;
  perform set_config('eq.op', '', true);
end $$;
create or replace function inv4() returns int language sql stable as $$
  select count(*)::int from equipment_orders o where o.total <> eq_order_lines_sum(o.id) + o.manual_adjustment + o.bundle_adjustment or o.bundle_adjustment > 0
$$;
create or replace function fp_pay() returns text language sql stable as $$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from service_payments t), '')) || '/' ||
         coalesce((select sum(paid)::text from equipment_orders), '0')
$$;
create or replace function tot(oid uuid) returns numeric language sql stable as $$ select total from equipment_orders where id = oid $$;
create or replace function tt(oid uuid) returns text language sql stable as $$ select trim_scale(total)::text from equipment_orders where id = oid $$;
create or replace function aa(oid uuid) returns text language sql stable as $$ select trim_scale(bundle_adjustment)::text from equipment_orders where id = oid $$;
create or replace function adj(oid uuid) returns numeric language sql stable as $$ select bundle_adjustment from equipment_orders where id = oid $$;
create or replace function stz(pid uuid) returns text language sql stable as $$ select state || '/' || reason from equipment_bundle_status where player_id = pid $$;
create or replace function nact(pid uuid) returns int language sql stable as $$ select count(*)::int from equipment_bundles where player_id = pid and state = 'active' $$;
create or replace function nall(pid uuid) returns int language sql stable as $$ select count(*)::int from equipment_bundles where player_id = pid $$;
create or replace function snap() returns text language sql stable as $$
  select md5((select coalesce(string_agg(o::text, '|' order by o.id), '') from equipment_orders o) || '#' ||
             (select count(*)::text from equipment_order_events) || '#' || (select coalesce(string_agg(b::text, '|' order by b.id), '') from equipment_bundles b))
$$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

-- А1: поля, значения по умолчанию и проверка
select ok((select count(*) = 5 from information_schema.columns where table_name = 'equipment_orders'
  and column_name in ('discount_forfeited', 'manual_adjustment', 'bundle_adjustment', 'discount_state', 'legacy_bundle_id')), 'А1: пять новых полей заказа');
select is((select column_default from information_schema.columns where table_name = 'equipment_orders' and column_name = 'discount_forfeited'), 'false', 'А1: отказ по умолчанию false');
select ok(exists (select 1 from pg_constraint where conrelid = 'equipment_orders'::regclass and conname = 'equipment_orders_bundle_adjustment_check'), 'А1: bundle_adjustment <= 0 (проверка есть)');

-- А13: пока нет отметки заморозки, предпросмотр и пересчёт отказывают.
-- Миграция 0207 на тестовой базе (заказов нет) ставит отметку freeze_2c: для состояния «только 0205» снимаем её на время теста.
alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
delete from equipment_bundle_steps where step = 'freeze_2c';
alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;
select as_user('00000000-0000-0000-0000-0000006521a1');
select throws_ok($$select eq_bundle_preview(pu(1))$$, '55000', 'bundle freeze not applied', 'А13: предпросмотр без отметки 2c');
select throws_ok($$select eq_bundle_recalc(pu(1), 'manual')$$, '55000', 'bundle freeze not applied', 'А13: пересчёт без отметки 2c');
select as_pg();
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'тест');

-- А5: значения по умолчанию совпадают с clubSettings.ts (клиентский тест паритета читает этот файл)
select is(eq_bundle_setting('00000000-0000-0000-0000-0000006521c1', 'equip.discPct'), '15', 'А5: процент по умолчанию');
select is(eq_bundle_setting('00000000-0000-0000-0000-0000006521c1', 'equip.discRound'), '5', 'А5: округление по умолчанию');
select is(eq_bundle_setting('00000000-0000-0000-0000-0000006521c1', 'equip.fullPrice'), 'Носки, Гетры', 'А5: полная цена по умолчанию');

-- А3: чистая функция
select is((eq_bundle_calc(jsonb_build_object(
  'settings', '{"pct":"50","round":"10","need_own":"a","need_all":"a","full":""}'::jsonb,
  'orders', jsonb_build_array(jsonb_build_object('id', u(1), 'status', 'accepted', 'created_at', now(), 'ordered_on', null, 'forfeited', false, 'frozen', false)),
  'lines', jsonb_build_array(jsonb_build_object('id', u(2), 'order_id', u(1), 'kit', 'A', 'quantity', 1, 'unit_price', 30))))->>'discount')::numeric,
  10::numeric, 'А3: округление «половина вверх» (15 -> 20, скидка 10)');
select is((eq_bundle_calc(jsonb_build_object(
  'settings', '{"pct":"15","round":"5","need_own":"a","need_all":"a","full":"a"}'::jsonb,
  'orders', jsonb_build_array(jsonb_build_object('id', u(1), 'status', 'accepted', 'created_at', now(), 'ordered_on', null, 'forfeited', false, 'frozen', false)),
  'lines', jsonb_build_array(jsonb_build_object('id', u(2), 'order_id', u(1), 'kit', 'A', 'quantity', 1, 'unit_price', 300))))->>'reason'),
  'not_complete', 'А3: позиция из «по полной цене» в комплект не входит');

-- S1 (А4): Ф оплачена на О1, затем КД на О2: скидка 95 на О2, оплата остаётся на О1
select mk_order(u(11), pu(1), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(12), pu(1), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_add_payment(u(11), 300, null, 'Наличные');
select as_pg();
create temp table fp (k text, v text);
insert into fp values ('s1_before', fp_pay());
select as_user('00000000-0000-0000-0000-0000006521a1');
select is(eq_bundle_recalc(pu(1))->>'closing_order_id', u(12)::text, 'А7: замыкающий заказ возвращается');
select as_pg();
select is(tot(u(12)), 225::numeric, 'А4/S1: комплект 620 -> 525: итог О2 225');
select is(tot(u(11)), 300::numeric, 'А4/S1: итог О1 300');
select is(adj(u(12)), -95::numeric, 'А4/S1: скидка 95 на замыкающем заказе');
select is((select paid from equipment_orders where id = u(11)), 300::numeric, 'А4/S1: оплата 300 осталась на О1');
select is((select sum(greatest(total - paid, 0)) from equipment_orders where player_id = pu(1)), 225::numeric, 'А4/S1: остаток 225');
select is(fp_pay(), (select v from fp where k = 's1_before'), 'И1: журнал платежей и paid не изменились расчётом');
select is(stz(pu(1)), 'active/ok', 'А2: состояние ребёнка active/ok');
select is(nact(pu(1)), 1, 'А2: одна активная запись комплекта');
select is((select discount_state from equipment_orders where id = u(12)), 'ok', 'А1: discount_state ok');
select is((select count(*)::int from equipment_order_events where order_id = u(12) and event = 'recalc'), 1, 'события: пересчёт записан');
select is(inv4(), 0, 'И4: итог = строки + корректировка + скидка');

-- И6: повторный запуск ничего не меняет (кроме журнала запуска)
insert into fp values ('snap1', snap());
create temp table rc (n int);
insert into rc select count(*)::int from equipment_bundle_runs;
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(snap(), (select v from fp where k = 'snap1'), 'И6: заказы, комплекты и события не изменились при повторе');
select is((select count(*)::int from equipment_bundle_runs), (select n + 1 from rc), 'И6: пишется только журнал запуска');

-- S2: один заказ; Носки по полной цене
select mk_order(u(21), pu(2), '2026-10-01 10:00+04', '2026-10-01', false,
  '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150},{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110},{"kit":"Носки","price":20}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(2));
select as_pg();
select is(tot(u(21)), 545::numeric, 'S2: 620 -> 525, Носки 20 по полной цене');

-- S3: обратный порядок
select mk_order(u(31), pu(3), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk_order(u(32), pu(3), '2026-10-02 10:00+04', '2026-10-02', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(3));
select as_pg();
select is(tt(u(31)) || '/' || tt(u(32)), '320/205', 'S3: замыкает поздний заказ: 320 и 205');

-- S4: третий заказ «Дождевик» после комплекта стоит 110 (дефект «15 ₾» устранён), запись комплекта не пересоздаётся
select mk_order(u(13), pu(1), '2026-10-10 10:00+04', '2026-10-10', false, '[{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tot(u(13)), 110::numeric, 'А4/S4: третий заказ Дождевик 110');
select is(tot(u(12)), 225::numeric, 'S4: скидка комплекта не изменилась');
select is(nall(pu(1)), 1, 'S4: новая запись комплекта не создавалась');

-- S9: рассрочка на незначимом заказе: скидка остаётся
select mk_order(u(14), pu(1), '2026-10-11 10:00+04', '2026-10-11', true, '[{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tt(u(12)) || '/' || tt(u(14)), '225/110', 'А4/S9: Д2 в рассрочку: скидка комплекта остаётся');

-- S10/А9: рассрочка у заказа комплекта снимает скидку; ручной сброс отказа возвращает расчёт
select set_config('eq.op', 'forfeit', true);
update equipment_orders set discount_forfeited = true where id = u(12);
select set_config('eq.op', '', true);
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tot(u(12)), 320::numeric, 'S10: отказ у заказа комплекта: скидка снята');
select is(stz(pu(1)), 'none/forfeited_order', 'S10: причина forfeited_order');
select is((select revoked_reason from equipment_bundles where player_id = pu(1) and state = 'revoked'), 'forfeited_order', 'S10: запись комплекта отозвана');
select as_user('00000000-0000-0000-0000-0000006521b1');
select throws_ok($$select eq_forfeit_reset(u(12), 'ошибка')$$, '42501', 'forbidden', 'А9: локальный администратор не сбрасывает отказ');
select as_user('00000000-0000-0000-0000-0000006521a1');
select throws_ok($$select eq_forfeit_reset(u(12), '  ')$$, '22023', 'reason required', 'А9: причина обязательна');
select as_pg();
insert into fp values ('rs_before', fp_pay());
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_forfeit_reset(u(12), 'родитель вернул на полную оплату');
select as_pg();
select is((select discount_forfeited from equipment_orders where id = u(12)), false, 'А9: отказ сброшен');
select is(tot(u(12)), 320::numeric, 'А9: итог сам не меняется до пересчёта');
select is((select count(*)::int from equipment_order_events where order_id = u(12) and event = 'forfeit_reset' and reason like 'родитель%'), 1, 'А9: событие с причиной');
select is(fp_pay(), (select v from fp where k = 'rs_before'), 'А9/И1: платежи не затронуты');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tot(u(12)), 225::numeric, 'А9: после пересчёта скидка снова на О2');
select is(nall(pu(1)), 2, 'S10: прежняя запись остаётся revoked, новая active');

-- S6 / И2: заказы разных детей не смешиваются
select mk_order(u(61), pu(6), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(71), pu(7), '2026-10-02 10:00+04', '2026-10-02', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(6)); select eq_bundle_recalc(pu(7));
select as_pg();
select is(tt(u(61)) || '/' || tt(u(71)), '300/320', 'И2/S6: разные дети: скидки нет');

-- S7, S8: рассрочка у участника
select mk_order(u(81), pu(8), '2026-10-01 10:00+04', '2026-10-01', true, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(82), pu(8), '2026-10-02 10:00+04', '2026-10-02', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk_order(u(91), pu(9), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(92), pu(9), '2026-10-02 10:00+04', '2026-10-02', true, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(8)); select eq_bundle_recalc(pu(9));
select as_pg();
select is(tt(u(81)) || '/' || tt(u(82)), '300/320', 'А4/S7: Ф в рассрочку и КД полная: скидки нет');
select is(tt(u(91)) || '/' || tt(u(92)), '300/320', 'А4/S8: КД в рассрочку (замыкающий): скидки нет');

-- S12–S13: отмена заказа с отказом, затем новый заказ: отменённый не блокирует (R1)
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_cancel_order(u(81), 'ошибка заказа');
select eq_bundle_recalc(pu(8));
select as_pg();
select is(stz(pu(8)), 'none/not_complete', 'S12: без отменённой Ф комплекта нет');
select mk_order(u(83), pu(8), '2026-10-09 10:00+04', '2026-10-09', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(8));
select as_pg();
select is(tt(u(83)) || '/' || tt(u(82)), '205/320', 'S13: отказ отменённого заказа не блокирует: скидка 95 на новом заказе');

-- S14, А10, А11: отмена замыкающего заказа
select mk_order(u(111), pu(11), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(112), pu(11), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(11));
select eq_add_payment(u(112), 100, null, 'Наличные');
select eq_cancel_order(u(112), 'дубль');
select as_pg();
select is(tot(u(112)), 320::numeric, 'А11 (с 0208 отмена пересчитывает сама): у отменённого замыкающего скидка снята');
insert into fp values ('s14_before', fp_pay());
select throws_ok($$update equipment_orders set inscription = 'x' where id = u(112)$$, '22023', 'order cancelled', 'А10: прочие поля отменённого заказа заморожены');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(11));
select as_pg();
select is(tt(u(112)) || '/' || aa(u(112)), '320/0', 'А10/S14: у отменённого замыкающего скидка снята');
select is((select revoked_reason from equipment_bundles where player_id = pu(11)), 'closing_order_cancelled', 'S14: причина отзыва closing_order_cancelled');
select is(stz(pu(11)), 'none/not_complete', 'S14: состояние none/not_complete');
select is(fp_pay(), (select v from fp where k = 's14_before'), 'S14/И1: платежи не меняются, возврат не создаётся');
select is((select paid from equipment_orders where id = u(112)), 100::numeric, 'S14: 100 остаются на отменённом заказе');

-- А12: сводка по ребёнку
select as_user('00000000-0000-0000-0000-0000006521a1');
select is((select paid_on_cancelled::text || '/' || due_active::text || '/' || orders_cancelled::text from eq_player_equipment_summary(pu(11))), '100.00/300.00/1', 'А12: на отменённых 100, к оплате по действующим 300 (О1 не оплачен)');
select as_user('00000000-0000-0000-0000-0000006521b2');
select is((select count(*)::int from eq_player_equipment_summary(pu(11)) where paid_on_cancelled <> 0), 0, 'А12: чужой родитель не видит заказов ребёнка (RLS заказов)');
select as_pg();

-- S17, А11: восстановление, затем новый расчёт даёт новую запись
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_restore_order(u(112), 'ошибка отмены', eq_restore_preview(u(112))->>'fingerprint');
select as_pg();
select is(tot(u(112)), 225::numeric, 'А11 (с 0208 восстановление пересчитывает само): скидка вернулась');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(11));
select as_pg();
select is(tot(u(112)), 225::numeric, 'S17: после пересчёта итог 225, платёж 100 на месте');
select is(nall(pu(11)) || '/' || nact(pu(11)), '2/1', 'S17: прежняя запись revoked, новая active');

-- S19: скидка переезжает при восстановлении более раннего заказа
select mk_order(u(121), pu(12), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(122), pu(12), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk_order(u(123), pu(12), '2026-10-10 10:00+04', '2026-10-10', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_cancel_order(u(121), 'тест');
select eq_bundle_recalc(pu(12));
select as_pg();
select is(tt(u(123)) || '/' || tt(u(122)), '205/320', 'S19: до восстановления скидка на О3');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_restore_order(u(121), 'тест', eq_restore_preview(u(121))->>'fingerprint');
select eq_bundle_recalc(pu(12));
select as_pg();
select is(tt(u(123)) || '/' || tt(u(122)) || '/' || tt(u(121)), '300/225/300', 'S19: скидка переехала на О2, итог О3 вернулся к 300');

-- S22: правка состава снимает скидку
select mk_order(u(131), pu(13), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(132), pu(13), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(13));
select eq_delete_line((select id from equipment_order_lines where order_id = u(132) and kit = 'Дождевик'));
select as_pg();
select is(tt(u(132)) || '/' || inv4(), '115/0', 'А8/И4: после удаления строки итог 115 (210 − 95), равенство сохранено');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(13));
select as_pg();
select is(tt(u(132)) || '/' || stz(pu(13)), '210/none/not_complete', 'S22: без дождевика комплекта нет: итог 210');

-- S24: заморожённый (исторический) комплект расчёт не трогает
select mk_order(u(141), pu(14), '2026-09-01 10:00+04', '2026-09-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(142), pu(14), '2026-09-05 10:00+04', '2026-09-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select set_config('eq.op', 'backfill', true);
update equipment_orders set total = 225, manual_adjustment = -95 where id = u(142);
select set_config('eq.op', '', true);
select freeze(u(141), pu(14)); select freeze(u(142), pu(14));
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(14));
select as_pg();
select is(tt(u(141)) || '/' || tt(u(142)) || '/' || aa(u(142)), '300/225/0', 'S24/В5: заморозка: вторая скидка не добавлена, итог 225');
select is(nact(pu(14)), 0, 'S24: активного комплекта у замороженного ребёнка нет');

-- А6: порядок и ничья
select mk_order(u(171), pu(17), '2026-10-01 10:00+04', null, false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(172), pu(17), '2026-10-01 10:00+04', null, false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select is(eq_bundle_recalc(pu(17))->>'closing_order_id', u(172)::text, 'А6: ничья решается по id: замыкающий с наибольшим id');
select as_pg();
select ok((select tie_break_id from equipment_bundle_runs where player_id = pu(17) order by id desc limit 1), 'А6: в журнале запуска отметка tie_break_id');
select mk_order(u(181), pu(18), '2026-10-01 10:00+04', '2026-10-03', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk_order(u(182), pu(18), '2026-10-01 10:00+04', null, false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select as_user('00000000-0000-0000-0000-0000006521a1');
select is(eq_bundle_recalc(pu(18))->>'closing_order_id', u(181)::text, 'А6: пустая дата считается ранней: замыкает заказ с датой');
select as_pg();
select ok(not (select tie_break_id from equipment_bundle_runs where player_id = pu(18) order by id desc limit 1), 'А6: ничьи нет, отметки нет');

-- А5/S26–S28: ошибка настроек, auto не снимает, ручной снимает только после успешной проверки
select mk_order(u(151), pu(15), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(152), pu(15), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-0000006521c1', 'equip.discPct', 'abc');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(15));
select as_pg();
select is(stz(pu(15)), 'unchecked/settings_invalid', 'S26: некорректный процент: unchecked');
select is((select reason_detail from equipment_bundle_status where player_id = pu(15)), 'equip.discPct: abc', 'S26: подробность ошибки');
select is(tt(u(152)) || '/' || (select discount_state from equipment_orders where id = u(152)), '320/unchecked', 'S26: заказ без скидки, discount_state unchecked');
update club_settings set value = '15' where key = 'equip.discPct';
select is(eq_bundle_run(pu(15), 'auto', true, 'edit')->>'skipped', 'unchecked', 'А5: auto при unchecked пропускается');
select is(stz(pu(15)), 'unchecked/settings_invalid', 'А5: auto состояние не снимает');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(15));
select as_pg();
select is(stz(pu(15)) || '/' || tt(u(152)), 'active/ok/225', 'S28: ручной пересчёт после исправления снимает unchecked');
delete from club_settings where key = 'equip.discPct';

-- S27: условие discNeedAll сужено
select mk_order(u(161), pu(16), '2026-10-01 10:00+04', '2026-10-01', false, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk_order(u(162), pu(16), '2026-10-05 10:00+04', '2026-10-05', false, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-0000006521c1', 'equip.discNeedAll', 'Игровая форма');
select as_user('00000000-0000-0000-0000-0000006521a1');
select eq_bundle_recalc(pu(16));
select as_pg();
select is(stz(pu(16)) || '/' || tt(u(162)), 'none/need_all_failed/320', 'S27: по строкам замыкающего условие не выполнено');
delete from club_settings where key = 'equip.discNeedAll';

-- А7: предпросмотр только читает; права
select as_pg();
insert into fp values ('pv', snap());
select as_user('00000000-0000-0000-0000-0000006521a1');
create temp table pv_out as select eq_bundle_preview(pu(2)) as j;
select as_pg();
select is(snap(), (select v from fp where k = 'pv'), 'А7: предпросмотр ничего не меняет');
select is((select count(*)::int from equipment_bundle_runs where player_id = pu(2) and not applied), 0, 'А7: предпросмотр не пишет журнал');
select ok((select j ? 'orders' and j ? 'overpaid' and j ? 'closing_order_id' and j ? 'reason' from pv_out), 'А7: предпросмотр возвращает итоги до и после, переплату, замыкающий, причину');
select as_user('00000000-0000-0000-0000-0000006521b1');
select throws_ok($$select eq_bundle_preview(pu(2))$$, '42501', 'forbidden', 'А7: предпросмотр не для локального администратора');
select throws_ok($$select eq_bundle_recalc(pu(2))$$, '42501', 'forbidden', 'А7: пересчёт не для локального администратора');
select as_user('00000000-0000-0000-0000-0000006521a1');
select throws_ok($$select eq_bundle_recalc(pu(2), 'auto')$$, '22023', 'bad mode', 'А7: режим auto снаружи недоступен');
select throws_ok($$select eq_bundle_recalc('00000000-0000-0000-0000-000000000999')$$, 'P0002', 'player not found', 'А7: неизвестный ребёнок');
select as_pg();

-- А8: итог ниже оплаченного разрешён; оплата сверх итога по-прежнему нет
select as_user('00000000-0000-0000-0000-0000006521a1');
insert into ids select 'q1', eq_create_order(pu(19), '[{"kit":"Игровая форма"},{"kit":"Тренировочная форма","quantity":2}]'::jsonb, null, null, false, null);
select eq_add_payment((select id from ids where k = 'q1'), 400, null, 'Наличные');
select lives_ok($$select eq_edit_order((select id from ids where k = 'q1'), null, null, false, null, 100)$$, 'А8: итог 100 при оплаченных 400 разрешён');
select is((select manual_adjustment from equipment_orders where id = (select id from ids where k = 'q1')), -350::numeric, 'А8: расхождение ушло в manual_adjustment');
select is((select eq_order_overpaid(e) from equipment_orders e where id = (select id from ids where k = 'q1')), 300::numeric, 'А8: переплата 300 показывается');
select throws_ok($$select eq_add_payment((select id from ids where k = 'q1'), 1, null, 'Наличные')$$, '22023', 'paid above total', 'А8: оплата сверх итога отклоняется');
select throws_ok($$select eq_edit_order((select id from ids where k = 'q1'), null, null, false, null, -1)$$, '22023', 'bad amount', 'А8: отрицательная сумма отклоняется');
select lives_ok($$select eq_edit_line((select id from equipment_order_lines where order_id = (select id from ids where k = 'q1') and kit = 'Тренировочная форма'), 'M', 1)$$, 'А8: уменьшение количества ниже оплаченного разрешено');
select lives_ok($$select eq_delete_line((select id from equipment_order_lines where order_id = (select id from ids where k = 'q1') and kit = 'Тренировочная форма'))$$, 'А8: удаление строки ниже оплаченного разрешено');
select as_pg();
select is(inv4(), 0, 'И4: равенство сохраняется после всех правок');

-- Защита полей скидки и итога
select throws_ok($$update equipment_orders set bundle_adjustment = -5 where id = u(131)$$, '42501', 'discount fields are managed by eq_bundle_recalc', 'А1: прямая запись bundle_adjustment закрыта');
select throws_ok($$update equipment_orders set discount_forfeited = true where id = u(131)$$, '42501', 'discount fields are managed by eq_bundle_recalc', 'А1: прямая запись отказа закрыта');
select throws_ok($$insert into equipment_orders (club_id, player_id, total, paid, bundle_adjustment) values ('00000000-0000-0000-0000-0000006521c1', pu(20), 0, 0, -5)$$, '42501', 'discount fields are managed by eq_bundle_recalc', 'А1: вставка с bundle_adjustment закрыта');
update equipment_orders set total = tot(u(131)) + 10 where id = u(131);
select is((select trim_scale(manual_adjustment) from equipment_orders where id = u(131)) || '/' || inv4(), '10/0', 'И4: прямая правка total уходит в manual_adjustment');

-- Бэкфилл: повторное применение заполняет manual_adjustment у несогласованных заказов (в том числе отменённых)
select set_config('eq.op', 'backfill', true);
alter table equipment_orders disable trigger equipment_orders_guard;
update equipment_orders set manual_adjustment = 0 where id in (u(142), u(112));
alter table equipment_orders enable trigger equipment_orders_guard;
select set_config('eq.op', '', true);
select isnt(inv4(), 0, 'бэкфилл: заказы рассогласованы до повторного применения');
\i db/migrations/0205_eq_bundle_model.sql
select is(inv4(), 0, 'А1/бэкфилл: manual_adjustment восстановлен, итог не менялся');
select is(tot(u(142)), 225::numeric, 'бэкфилл: итог заказа не изменился');

-- А2: таблицы только добавляют записи; права
select throws_ok($$delete from equipment_bundles$$, '42501', null, 'А2: записи комплектов не удаляются');
select throws_ok($$update equipment_bundles set discount = 1$$, '42501', null, 'А2: поля комплекта не правятся');
select throws_ok($$update equipment_bundle_runs set mode = 'auto'$$, '42501', null, 'А2: журнал запусков только добавляется');
select throws_ok($$truncate equipment_bundle_steps$$, '42501', null, 'А2: отметки шагов не очищаются');
select throws_ok($$insert into equipment_bundles (player_id, closing_order_id, members, base, pct, round_to, discount, created_reason)
  select player_id, closing_order_id, members, base, pct, round_to, discount, 'manual' from equipment_bundles where state = 'active' limit 1$$, '23505', null, 'А2: у ребёнка не больше одной активной записи');
select as_user('00000000-0000-0000-0000-0000006521b2');
select is((select count(*)::int from equipment_bundles), 0, 'А2: родитель записей комплектов не видит');
select as_pg();
select ok(not has_table_privilege('authenticated', 'equipment_bundles', 'insert') and not has_table_privilege('anon', 'equipment_bundles', 'select'), 'А2: прямой записи нет, anon не читает');

-- И7: права на функции при привилегиях Supabase по умолчанию
select ok(not has_function_privilege('anon', 'eq_bundle_preview(uuid)', 'execute') and not has_function_privilege('anon', 'eq_bundle_recalc(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'eq_forfeit_reset(uuid,text)', 'execute') and not has_function_privilege('anon', 'eq_player_equipment_summary(uuid)', 'execute'), 'И7: anon не вызывает публичные функции');
select ok(has_function_privilege('authenticated', 'eq_bundle_preview(uuid)', 'execute') and has_function_privilege('authenticated', 'eq_bundle_recalc(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'eq_forfeit_reset(uuid,text)', 'execute') and has_function_privilege('authenticated', 'eq_player_equipment_summary(uuid)', 'execute'), 'И7: authenticated вызывает публичные функции');
select ok(not has_function_privilege('authenticated', 'eq_bundle_calc(jsonb)', 'execute') and not has_function_privilege('authenticated', 'eq_bundle_run(uuid,text,boolean,text)', 'execute')
  and not has_function_privilege('authenticated', 'eq_bundle_setting(uuid,text)', 'execute') and not has_function_privilege('anon', 'eq_bundle_run(uuid,text,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'eq_edit_order(uuid,text,text,boolean,text,numeric)', 'execute'), 'И7: внутренние функции закрыты, eq_edit_order для anon закрыт');

select * from finish();
rollback;
