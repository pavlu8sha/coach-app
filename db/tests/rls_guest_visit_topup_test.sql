-- pgTAP: разовый скрипт доплаты 5 ₾ Polosin Kirill за гостевое посещение 16.11 (db/ops/guest-visit-polosin-topup-5-2026-11-16.sql). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000c1', 9912, 'Тренер U9-B', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U7-A', 'Исани');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status, pay_mode, pay_mode_from) values
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Polosin Kirill', 'active', 'per_visit', '2026-11-01');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', '2026-11-16 12:00+04', 'training', 'ATT|2026-11-16', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- как было в проде: посещение добавлено по 15, оплачено 15 переводом, затем сумма поднята до 20
select as_user('00000000-0000-0000-0000-0000000000c1');
select session_guest_add('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d005');
reset role;
update session_guests set amount = 15 where session_id = '00000000-0000-0000-0000-0000000005a3';
select as_user('00000000-0000-0000-0000-0000000000c1');
select session_guest_set_paid('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d005', true, 'Перевод', null, '2026-11-16');
reset role;
update session_guests set amount = 20 where session_id = '00000000-0000-0000-0000-0000000005a3';

select is((select paid_amount from session_guests), 15.00::numeric, 'до скрипта оплачено 15 из 20');
\i db/ops/guest-visit-polosin-topup-5-2026-11-16.sql
select is((select paid_amount from session_guests), 20.00::numeric, 'после скрипта оплачено 20');
select is((select amount from session_guests), 20.00::numeric, 'сумма посещения осталась 20');
select is((select count(*)::int from service_payments where kind = 'visit'), 2, 'в журнале две строки: 15 и 5');
select is((select count(*)::int from service_payments where kind = 'visit' and amount = 15 and method = 'Перевод' and paid_on = '2026-11-16'), 1, 'оригинальная строка 15 не тронута');
select is((select sum(amount) from service_payments where kind = 'visit'), 20.00::numeric, 'в журнале в сумме 20');
\i db/ops/guest-visit-polosin-topup-5-2026-11-16.sql
select is((select count(*)::int from service_payments where kind = 'visit'), 2, 'повторный запуск ничего не добавляет');

select * from finish();
rollback;
