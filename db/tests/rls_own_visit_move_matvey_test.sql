-- pgTAP: разовый скрипт переноса 20 ₾ Matvey с абонемента на оплату визита 02.11 (db/ops/own-visit-move-matvey-2026-11-02.sql). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U7-A', 'Исани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Fedorov Matvey', 'active');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 16:00+04', 'training', 'ATT|2026-11-02', 'regular');
-- отметка «Был» поставлена, когда игрок ещё был на абонементе: визит автоматически не создан
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present');
insert into payments (player_id, amount, paid_on, method, for_month) values
  ('00000000-0000-0000-0000-00000000d001', 20, '2026-11-03', 'Перевод', '2026-11-01');
update players set pay_mode = 'per_visit', pay_mode_from = '2026-11-01' where id = '00000000-0000-0000-0000-00000000d001';

select is((select count(*)::int from own_visits), 0, 'до скрипта визита за 02.11 нет');
\i db/ops/own-visit-move-matvey-2026-11-02.sql
select is((select count(*)::int from own_visits where paid and paid_amount = 20 and amount = 20 and method = 'Перевод'), 1, 'визит 02.11 создан и оплачен переводом на 20');
select is((select coalesce(sum(amount), 0) from payments where player_id = '00000000-0000-0000-0000-00000000d001' and pay_month = '2026-11-01'), 0::numeric, 'платежи абонемента за ноябрь в сумме 0');
select is((select count(*)::int from payments where player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'в payments только исходная строка и минус');
select is((select paid_on from payments where cancels is not null), date '2026-11-03', 'минус записан датой исходного платежа');
select is((select amount from service_payments where kind = 'own_visit' and ref_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 20.00::numeric, 'в журнале оплата визита 20, вид own_visit');
select is((select paid_on from service_payments where kind = 'own_visit'), date '2026-11-03', 'оплата визита датой 03.11');
\i db/ops/own-visit-move-matvey-2026-11-02.sql
select is((select count(*)::int from payments) + (select count(*)::int from service_payments) + (select count(*)::int from own_visits), 4, 'повторный запуск ничего не добавляет');
select is((select count(*)::int from subscriptions), 0, 'абонементы не создаются');

select * from finish();
rollback;
