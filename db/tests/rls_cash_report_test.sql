-- pgTAP: кассовый отчёт (0078). Только администратор; фильтры по периоду, локации, сотруднику, способу;
-- итоги по сотрудникам и способам сходятся с общей суммой; отмена — строка с минусом.
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9201, 'Гил', true),
  ('00000000-0000-0000-0000-0000000000a2', 9202, 'Дима', true),
  ('00000000-0000-0000-0000-0000000000b1', 9203, 'Паша', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11-B', 'Отрачала');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');
insert into camps (id, club_id, name, location, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c001', 'Сбор', 'Отрачала', '2026-10-01', '2026-10-31');
insert into camp_participants (camp_id, player_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000d002');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- платёж без автора (импорт) — попадает в «не указан»
insert into payments (id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000d001', 100, '2026-10-05', 'Наличные');
-- граница периода: сентябрь не попадает в октябрь
insert into payments (id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-00000000d001', 999, '2026-09-30', 'Наличные');

select as_user('00000000-0000-0000-0000-0000000000a2');
insert into payments (id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', 165, '2026-10-06', 'Перевод');
insert into payments (id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d002', 50, '2026-10-06', 'Исправление');
insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method)
  select '00000000-0000-0000-0000-0000000000c2', cp.id, cp.player_id, 30, '2026-10-06', 'payment', 'Наличные'
    from camp_participants cp where cp.camp_id = '00000000-0000-0000-0000-0000000000c2';

select as_user('00000000-0000-0000-0000-0000000000a1');
-- отмена платежа Ани: строка с минусом, способ берётся от исходного
insert into payments (id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d001', -100, '2026-10-07', 'Наличные');

-- 1. итог за октябрь: 100 + 165 − 100 + 50 + 30 = 245 (сентябрьские 999 не входят)
select is((select (cash_report('2026-10-01', '2026-10-31')->>'total')::numeric), 245::numeric, 'итог за месяц без сентябрьского платежа');
-- 2. по способам: наличные 100 − 100 + 30 = 30; перевод 165; «не указан» 50
select is((select (x->>'sum')::numeric from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'by_method') x where x->>'method' = 'Наличные'), 30::numeric, 'наличные: 100 − 100 + 30');
-- 3. сумма по способам равна итогу
select is((select sum((x->>'sum')::numeric) from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'by_method') x), 245::numeric, 'сумма по способам сходится с итогом');
-- 4. по сотрудникам: Дима 165 + 50 + сбор 30 = 245 (платежи записаны от его сессии), Гил −100 (отмена), без автора 100
select is((select (x->>'sum')::numeric from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'by_staff') x where x->>'name' = 'Дима'), 245::numeric, 'Дима: 165 + 50 + сбор 30 (автор записан сервером)');
-- 5. сумма по сотрудникам равна итогу (включая «не указан»)
select is((select sum((x->>'sum')::numeric) from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'by_staff') x), 245::numeric, 'сумма по сотрудникам сходится с итогом');
-- 6. детализация: сумма строк равна итогу
select is((select sum((x->>'amount')::numeric) from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'rows') x), 245::numeric, 'сумма строк детализации равна итогу');
-- 7. локация: Исани — Аня 100 − 100 = 0 (Отрачала с Борей и сбором — 245, см. документ миграции)
select is((select (cash_report('2026-10-01', '2026-10-31', 'Исани')->>'total')::numeric), 0::numeric, 'локация Исани: абонемент Ани 100 − 100');
-- 8. фильтр по сотруднику и по способу
select is((select (cash_report('2026-10-01', '2026-10-31', null, '00000000-0000-0000-0000-0000000000a1')->>'total')::numeric), -100::numeric, 'фильтр по Гилу: только его отмена −100');
select is((select (cash_report('2026-10-01', '2026-10-31', null, null, 'Перевод')->>'total')::numeric), 165::numeric, 'фильтр «Перевод»: только перевод');
-- 9. один день: 5 октября — только 100
select is((select (cash_report('2026-10-05', '2026-10-05')->>'total')::numeric), 100::numeric, 'один день: граница дня включительна');
-- 10. отмена видна в детализации как минус и не считается поступлением
select is((select count(*)::int from jsonb_array_elements(cash_report('2026-10-01', '2026-10-31')->'rows') x where (x->>'amount')::numeric < 0), 1, 'отмена видна строкой с минусом');
-- 11. не администратор не получает отчёт
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select cash_report('2026-10-01', '2026-10-31')$$, '42501', null, 'отчёт только для администратора');
-- 12. неверный период отклоняется
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select cash_report('2026-10-31', '2026-10-01')$$, '22023', null, 'конец периода раньше начала отклоняется');

select * from finish();
rollback;
