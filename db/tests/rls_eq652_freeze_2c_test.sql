-- pgTAP: #652 этап 2c (0207), заморозка исторических комплектов и отказ у заказов в рассрочку.
-- Условия: docs/acceptance/eq-652-stage2c-freeze-0207-2026-11-19.md (С1–С12), часть 2c в eq-652-stage2-bundle-discount-2026-11-16.md (В1–В7, И1–И7).
\set dq `sed -e '/^[[:space:]]*--/d' -e 's/;[[:space:]]*$//' db/ops/readonly-eq-freeze-2c-dryrun.sql`
begin;
create extension if not exists pgtap;
select plan(73);

-- На тестовой базе 0207 уже поставила отметку freeze_2c (заказов не было). Для проверки состояния «только 0205» снимаем отметку
-- на время теста (откатывается вместе с транзакцией) и заново применяем миграцию с привилегиями по умолчанию Supabase (И7).
alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
delete from equipment_bundle_steps where step = 'freeze_2c';
alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;
drop function eq_freeze_2c(jsonb);
drop function eq_freeze_2c_fp();
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0207_eq_freeze_2c.sql
-- Миграция на базе без заказов сама поставила отметку (ожидания не применяются): С12, снимаем для сценариев
select ok(exists (select 1 from equipment_bundle_steps where step = 'freeze_2c'), 'С5/С11: на базе без заказов 0207 ставит отметку freeze_2c без ожиданий');
alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
delete from equipment_bundle_steps where step = 'freeze_2c';
alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;

create or replace function u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000066' || lpad(n::text, 4, '0'))::uuid $$;
create or replace function pu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000006623' || lpad(n::text, 2, '0'))::uuid $$;

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000006621c1', 'Клуб'), ('00000000-0000-0000-0000-0000006621c2', 'Другой клуб'), ('00000000-0000-0000-0000-0000006621c3', 'Клуб с процентом 0');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-0000006621c3', 'equip.discPct', '0');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000006621a1', 966211, 'Админ', true),
  ('00000000-0000-0000-0000-0000006621b2', 966213, 'Родитель', false);
insert into players (id, club_id, full_name, status)
  select pu(n), case when n = 9 then '00000000-0000-0000-0000-0000006621c2'::uuid when n in (10, 11) then '00000000-0000-0000-0000-0000006621c3'::uuid else '00000000-0000-0000-0000-0000006621c1'::uuid end, 'Игрок ' || n, 'active' from generate_series(1, 12) n;

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
-- Историческая запись заказа: итог задаётся напрямую (как у импортированных и старых заказов), корректировка получается триггером 0205.
create or replace function mk(oid uuid, pid uuid, od date, inst boolean, adj numeric, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid, created_at)
  values (oid, (select club_id from players where id = pid), pid, od, inst, 0, 0, coalesce(od::timestamp at time zone 'Asia/Tbilisi', timestamptz '2000-01-01 00:00:00+04'));
  for i in select * from jsonb_array_elements(items) loop
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, i->>'kit', 'M', coalesce((i->>'qty')::int, 1), (i->>'price')::numeric);
  end loop;
  update equipment_orders set total = eq_order_lines_sum(oid) + adj where id = oid;
end $$;
create or replace function inv4() returns int language sql stable as $$
  select count(*)::int from equipment_orders o where o.total <> eq_order_lines_sum(o.id) + o.manual_adjustment + o.bundle_adjustment or o.bundle_adjustment > 0
$$;
-- Независимый от eq_freeze_2c_fp снимок: все старые колонки заказов, строки, журнал, события (число), платежи и отпечаток без новых колонок.
create or replace function snap_old() returns text language sql stable as $$
  select md5(
    (select coalesce(string_agg((to_jsonb(o) - 'discount_forfeited' - 'manual_adjustment' - 'bundle_adjustment' - 'discount_state' - 'legacy_bundle_id')::text, '|' order by o.id), '') from equipment_orders o) || '#' ||
    (select coalesce(string_agg(l::text, '|' order by l.id), '') from equipment_order_lines l) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t.id), '') from service_payments t))
$$;
create or replace function snap_state() returns text language sql stable as $$
  select md5((select coalesce(string_agg(o::text, '|' order by o.id), '') from equipment_orders o) || '#' ||
             (select count(*)::text from equipment_order_events) || '#' ||
             (select count(*)::text from equipment_legacy_bundles) || '#' ||
             (select count(*)::text from equipment_bundle_steps) || '#' ||
             (select count(*)::text from equipment_bundles) || '#' || (select count(*)::text from equipment_bundle_runs))
$$;
create or replace function lb(oid uuid) returns uuid language sql stable as $$ select legacy_bundle_id from equipment_orders where id = oid $$;
create or replace function tt(oid uuid) returns text language sql stable as $$ select trim_scale(total)::text from equipment_orders where id = oid $$;
create or replace function ma(oid uuid) returns text language sql stable as $$ select trim_scale(manual_adjustment)::text from equipment_orders where id = oid $$;
create temp table fp (k text, v text);
grant all on fp to authenticated;
create temp table res (j jsonb);

insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000006621c1', 'Игровая форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006621c1', 'Тренировочная форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006621c1', 'Спортивный костюм', 210, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006621c1', 'Дождевик', 110, '2026-09-01');

-- Данные (все итоги заданы напрямую, как у исторических заказов)
-- P1: полный комплект 620 -> 525, замыкающий О12 (итог 225 = 320 − 95): legacy_confirmed. Оплата 300 на О11.
select mk(u(11), pu(1), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(12), pu(1), '2026-10-05', false, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
-- P2: такой же комплект, но замыкающий в рассрочку: legacy_review и отказ
select mk(u(21), pu(2), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(22), pu(2), '2026-10-05', true, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
-- P3: разница −40 без комплекта: manual_down. P4: +20: manual_up. P5: рассрочка без скидки: exact + отказ
select mk(u(31), pu(3), '2026-10-02', false, -40, '[{"kit":"Игровая форма","price":150}]');
select mk(u(41), pu(4), '2026-10-02', false, 20, '[{"kit":"Игровая форма","price":150}]');
select mk(u(51), pu(5), '2026-10-02', true, 0, '[{"kit":"Игровая форма","price":150}]');
-- P6: полный комплект, но скидка не 95 (−50): legacy_review
select mk(u(61), pu(6), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(62), pu(6), '2026-10-05', false, -50, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
-- P7: отменённый заказ с разницей −10 (manual_down) и рассрочкой (отказ не ставится отменённому)
select mk(u(71), pu(7), '2026-10-02', true, -10, '[{"kit":"Игровая форма","price":150}]');
-- P8: заказ без даты (created_at 2000-01-01) в рассрочку + комплект с заказом позже: порядок «пустая дата раньше»
select mk(u(81), pu(8), null, false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(82), pu(8), '2026-10-05', false, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
-- P9: другой клуб, свой полный комплект: классифицируется независимо (И2)
select mk(u(91), pu(9), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(92), pu(9), '2026-10-05', false, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
-- P10 (процент скидки 0): неполный комплект и отрицательная разница: не комплект, не заморожен (manual_down)
select mk(u(101), pu(10), '2026-10-02', false, -40, '[{"kit":"Игровая форма","price":150}]');
-- P11 (процент скидки 0): полный комплект и отрицательная разница у замыкающего: на разбор (confirmed при нулевой скидке невозможен)
select mk(u(111), pu(11), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(112), pu(11), '2026-10-05', false, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006621a1');
select eq_add_payment(u(11), 300, null, 'Наличные');
select eq_add_payment(u(22), 100, null, 'Наличные');
select as_pg();
-- Отмена напрямую: до отметки freeze_2c функции eq_* с автопересчётом (0208) не работают, поэтому «старая» отмена задаётся данными.
select set_config('eq.op', 'cancel', true);
update equipment_orders set status = 'cancelled', status_before_cancel = status, cancelled_at = now() where id = u(71);
select set_config('eq.op', '', true);

select is(inv4(), 0, 'И4 до 2c: итог = строки + корректировка + скидка у всех заказов');
select is(ma(u(12)), '-95', 'В1: корректировка О12 = −95 (записана 0205), 2c её не меняет');
insert into fp values ('old', snap_old()), ('state', snap_state()), ('fp', eq_freeze_2c_fp()::text);

-- С5: ожидания не совпали -> ничего не применено
select throws_ok($$select eq_freeze_2c('{"orders": 3}')$$, '55000', null, 'С5: число заказов не совпало: остановка');
select throws_ok($$select eq_freeze_2c('{"legacy_confirmed": 14}')$$, '55000', null, 'С5: число legacy_confirmed не совпало: остановка');
select throws_ok($$select eq_freeze_2c('{"installment": 9}')$$, '55000', null, 'С5: число заказов в рассрочку не совпало: остановка');
select throws_ok($$select eq_freeze_2c('{"legacy_review": 0}')$$, '55000', null, 'С5: появился legacy_review: остановка');
select throws_ok($$select eq_freeze_2c('{"total": 1}')$$, '55000', null, 'С5: итог не совпал: остановка');
select is(snap_state(), (select v from fp where k = 'state'), 'С5: после остановки состояние идентично исходному');
select is((select count(*)::int from equipment_bundle_steps where step = 'freeze_2c'), 0, 'С5: отметки нет');

-- С9 (И7): права
select as_user('00000000-0000-0000-0000-0000006621a1');
select throws_ok($$select eq_freeze_2c('{}')$$, '42501', null, 'С9: authenticated не может вызвать eq_freeze_2c');
select as_pg();
select ok(not has_function_privilege('anon', 'eq_freeze_2c(jsonb)', 'execute') and not has_function_privilege('authenticated', 'eq_freeze_2c(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'eq_freeze_2c(jsonb)', 'execute'), 'С9: нет прав у anon, authenticated, service_role (база с привилегиями по умолчанию)');
select ok(not has_function_privilege('anon', 'eq_freeze_2c_fp()', 'execute') and not has_function_privilege('authenticated', 'eq_freeze_2c_fp()', 'execute')
  and not has_function_privilege('service_role', 'eq_freeze_2c_fp()', 'execute'), 'С9: служебная функция отпечатков закрыта');

-- До применения: предохранитель 2a держит
select as_user('00000000-0000-0000-0000-0000006621a1');
select throws_ok($$select eq_bundle_recalc(pu(1))$$, '55000', 'bundle freeze not applied', 'С12/А13: до 2c пересчёт отказывает');
select as_pg();

-- Пробный прогон db/ops/readonly-eq-freeze-2c-dryrun.sql до применения: потом сверяем его с фактическим результатом 0207 по каждому заказу
create temp table dry as :dq;
grant select on dry to public;

-- Успешное применение. Ожидания по фикстуре: 13 заказов (P1..P9: 2+2+1+1+1+2+1+2+2 = 14), проверяем фактические числа
insert into res select eq_freeze_2c(jsonb_build_object('orders', 17, 'legacy_confirmed', 3, 'legacy_review', 3, 'manual_up', 1, 'manual_down', 3, 'exact', 7, 'installment', 3));
select is((select j->'classes'->>'legacy_confirmed' from res), '3', 'С1: legacy_confirmed: P1, P8, P9');
select is((select j->'classes'->>'legacy_review' from res), '3', 'С1: legacy_review: P2 (замыкающий в рассрочке), P6 (скидка не 95), P11 (процент 0, полный комплект)');
select is((select j->'classes'->>'manual_up' from res), '1', 'С1: manual_up: P4');
select is((select j->'classes'->>'manual_down' from res), '3', 'С1: manual_down: P3 (нет комплекта), P7 (отменён), P10 (процент 0, неполный комплект)');
select is((select j->'classes'->>'exact' from res), '7', 'С1: exact: остальные');
select is((select (j->>'bundles_confirmed')::int from res), 3, 'С2: три записи confirmed (по одной на ребёнка)');
select is((select (j->>'bundles_review')::int from res), 3, 'С2: три записи review (P2, P6, P11)');
select is((select (j->>'forfeited')::int from res), 3, 'С3/В2: отказ у трёх заказов в рассрочку (О22, О51 и отменённый О71)');
-- Пробный прогон совпадает с фактом 0207 (порядок и правила те же, что в eq_bundle_calc)
select is((select coalesce(jsonb_object_agg(substr(d."ключ", 7), d."значение"::int), '{}'::jsonb) from dry d where d."раздел" = 1 and d."ключ" like 'класс %'), (select j->'classes' from res),
  'пробный прогон: число заказов по классам равно результату 0207');
select is((select coalesce(array_agg(d."ключ"::uuid order by d."ключ"), '{}') from dry d where d."раздел" = 2),
  (select coalesce(array_agg(e.id order by e.id), '{}') from equipment_orders e where e.legacy_bundle_id is not null),
  'пробный прогон: список заказов к заморозке совпадает с фактически замороженными по каждому id');
select is((select d."значение"::int from dry d where d."раздел" = 1 and d."ключ" = 'заказов к заморозке'), (select (j->>'frozen_orders')::int from res), 'пробный прогон: число замороженных заказов равно результату 0207');
select is((select coalesce(array_agg(d."ключ"::uuid order by d."ключ"), '{}') from dry d where d."раздел" = 3),
  (select coalesce(array_agg(e.id order by e.id), '{}') from equipment_orders e where e.legacy_bundle_id is null and e.total <> eq_order_lines_sum(e.id)),
  'пробный прогон: раздел 3 = все незамороженные заказы с ненулевой delta');

-- С2: заморозка целиком
select ok(lb(u(11)) is not null and lb(u(11)) = lb(u(12)), 'С2: О11 и О12 в одном замороженном комплекте (целиком)');
select is((select kind from equipment_legacy_bundles where id = lb(u(12))), 'confirmed', 'С2: вид confirmed');
select is((select calc_discount from equipment_legacy_bundles where id = lb(u(12))), 95::numeric, 'С2: расчётная скидка 95');
select is((select count(*)::int from equipment_legacy_bundles where player_id = pu(1)), 1, 'С2: одна запись на ребёнка');
select ok(lb(u(81)) is not null and lb(u(81)) = lb(u(82)), 'В1/А6: P8, заказ без даты и поздний заказ заморожены одним комплектом');
select ok(lb(u(91)) is not null and lb(u(91)) <> lb(u(12)), 'И2: комплект другого клуба замораживается отдельно');
select is((select kind from equipment_legacy_bundles where id = lb(u(22))), 'review', 'С1: замыкающий в рассрочке: комплект «на разбор»');
select ok(lb(u(21)) = lb(u(22)), 'С1: на разбор заморожен и заказ-участник О21');
select is((select kind from equipment_legacy_bundles where id = lb(u(62))), 'review', 'С1: скидка не 95: на разбор');
select ok(lb(u(31)) is null and lb(u(41)) is null and lb(u(51)) is null and lb(u(71)) is null, 'С1: manual_up, manual_down, exact и отменённый не заморожены');
select ok(lb(u(101)) is null, 'pct=0: неполный комплект с отрицательной разницей (P10) не заморожен и не комплект');
select is((select kind from equipment_legacy_bundles where id = lb(u(112))), 'review', 'pct=0: полный комплект (P11) определён пробным расчётом, замыкающий на разбор');
select ok(lb(u(111)) = lb(u(112)), 'pct=0: участник P11 заморожен вместе с замыкающим');

-- С3: отказ
select ok((select discount_forfeited from equipment_orders where id = u(22)) and (select discount_forfeited from equipment_orders where id = u(51)), 'С3: рассрочка: отказ у О22 и О51');
select ok((select discount_forfeited from equipment_orders where id = u(71)) and (select status from equipment_orders where id = u(71)) = 'cancelled', 'С3/В2: отменённый заказ в рассрочку получил отказ и остался отменённым');
select ok(not exists (select 1 from equipment_orders where discount_forfeited and not installment), 'С3: без рассрочки отказа нет');
select is((select count(*)::int from equipment_orders where installment and not discount_forfeited), 0, 'В2: у всех заказов с installment = true есть отказ');
select is((select count(*)::int from equipment_order_events where event = 'forfeit'), 3, 'С3: три события forfeit (О22, О51, О71)');
select ok((select installment from equipment_orders where id = u(22)) and (select installment from equipment_orders where id = u(71)), 'С3: installment не менялся');
select is((select data->>'step' from equipment_order_events where order_id = u(22) and event = 'forfeit'), '2c', 'С3: событие помечено этапом 2c');

-- С4: ничего, кроме новых полей, не изменилось
select is(snap_old(), (select v from fp where k = 'old'), 'С4/И1/И3: заказы (старые колонки), строки и журнал не изменились');
select is(eq_freeze_2c_fp()::text, (select v from fp where k = 'fp'), 'С4: отпечатки до и после совпадают (как в baseline)');
select is(tt(u(12)), '225', 'С4: итог О12 225 не изменился');
select is(ma(u(12)), '-95', 'С4: manual_adjustment −95 не изменился');
select is((select paid from equipment_orders where id = u(11)), 300::numeric, 'С4: оплата 300 на О11');
select is(inv4(), 0, 'И4: после 2c итог = строки + корректировки у всех заказов');
select is((select count(*)::int from equipment_orders where bundle_adjustment <> 0), 0, 'В3: bundle_adjustment после 2c нигде не задан (скидки не пересчитывались)');
select is((select count(*)::int from equipment_bundles), 0, 'В3: комплектов расчёта нет, скидки не пересчитывались');
select is((select count(*)::int from equipment_bundle_runs), 0, 'В3: запусков расчёта нет');
select is((select count(*)::int from equipment_order_events where event = 'recalc'), 0, 'И3: событий пересчёта нет');
select is((select count(*)::int from equipment_bundle_steps where step = 'freeze_2c'), 1, 'С1: отметка freeze_2c поставлена');
select ok((select (note::jsonb->'before') = (note::jsonb->'after') from equipment_bundle_steps where step = 'freeze_2c'), 'С4: в note отпечатки до и после равны');

-- С7: повторный запуск ничего не меняет
insert into fp values ('state2', snap_state());
select is(eq_freeze_2c('{"orders": 3}')->>'skipped', 'already applied', 'С7: повторный запуск пропущен (даже с неверными ожиданиями)');
select is(snap_state(), (select v from fp where k = 'state2'), 'С7: состояние после повтора идентично');

-- В2: отмена -> восстановление -> пересчёт: отказ у заказа в рассрочку сохраняется, итог не меняется
select as_user('00000000-0000-0000-0000-0000006621a1');
select eq_restore_order(u(71), 'тест восстановления', true);
select as_pg();
select ok((select discount_forfeited from equipment_orders where id = u(71)) and (select status from equipment_orders where id = u(71)) <> 'cancelled', 'В2: после восстановления заказ действует и отказ сохранён');
select as_user('00000000-0000-0000-0000-0000006621a1');
select eq_bundle_recalc(pu(7));
select eq_cancel_order(u(71), 'тест повторной отмены');
select as_pg();
select ok((select discount_forfeited from equipment_orders where id = u(71)) and (select installment from equipment_orders where id = u(71)), 'В2: после пересчёта и повторной отмены отказ сохранён, installment не менялся');
select is(tt(u(71)), '140', 'В2: итог О71 не менялся (150 − 10)');
-- С6 (В5): после заморозки пересчёт не даёт вторую скидку
select as_user('00000000-0000-0000-0000-0000006621a1');
select is(eq_bundle_preview(pu(1))->>'changed', 'false', 'С6: предпросмотр замороженному ребёнку не предлагает изменений');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tt(u(12)), '225', 'С6/В5: ручной пересчёт: итог О12 остаётся 225 (вторая скидка не добавлена)');
select is((select bundle_adjustment from equipment_orders where id = u(12)), 0::numeric, 'С6: bundle_adjustment замороженного заказа 0');
select is((select count(*)::int from equipment_bundles where player_id = pu(1) and state = 'active'), 0, 'С6: активного комплекта расчёта нет');
select mk(u(13), pu(1), '2026-11-10', false, 0, '[{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006621a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tt(u(13)), '110', 'С6: новый заказ после комплекта стоит 110, комплект из замороженных не образуется');
select is(tt(u(12)), '225', 'С6: О12 по-прежнему 225');
-- Новый полный комплект того же ребёнка поверх замороженного замыкается без скидки на замороженные заказы
select mk(u(14), pu(1), '2026-11-11', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150},{"kit":"Спортивный костюм","price":210}]');
select mk(u(15), pu(1), '2026-11-12', false, 0, '[{"kit":"Дождевик","price":110}]');
select as_user('00000000-0000-0000-0000-0000006621a1');
select eq_bundle_recalc(pu(1));
select as_pg();
select is(tt(u(12)), '225', 'С6: замороженный О12 не тронут и после нового комплекта');
select is(tt(u(14)), '415', 'С6: новый полный комплект из незамороженных заказов получает скидку 95 на замыкающем заказе');
select is(inv4(), 0, 'И4: после пересчётов равенство итога сохраняется');

-- Права после применения
select ok(not has_function_privilege('authenticated', 'eq_freeze_2c(jsonb)', 'execute'), 'С9: после применения права по-прежнему закрыты');

select * from finish();
rollback;
