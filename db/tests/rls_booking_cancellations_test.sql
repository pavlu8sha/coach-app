-- pgTAP: отмена записи родителем (в том числе оплаченной) и финансовые решения админа (0145, #274, PR 9).
begin;
create extension if not exists pgtap;
select plan(18);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9602, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9603, 'Родитель 2', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тема 1');
insert into ids select 'i2', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 4, '19:00', false, 'Тема 2');
insert into ids select 'i3', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 5, '19:00', false, 'Тема 3');
insert into ids select 'i4', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 6, '19:00', false, 'Тема 4');
insert into ids select 'x1', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал');
-- Аня: i1 оплачена (будет отмена), i2 не оплачена, i3 оплачена (возврат), i4 оплачена (перенос на i2)
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i3'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i4'), '00000000-0000-0000-0000-00000000d001');
select ind_set_paid((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
select ind_set_paid((select id from ids where k = 'i3'), '00000000-0000-0000-0000-00000000d001', true, 'Перевод');
select ind_set_paid((select id from ids where k = 'i4'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select extra_set_paid((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');

-- родитель
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'чужую запись отменить нельзя');
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select is((select count(*)::int from individual_bookings where session_id = (select id from ids where k = 'i1')), 0, 'оплаченную запись родитель отменил, место свободно');
select booking_cancel('individual', (select id from ids where k = 'i3'), '00000000-0000-0000-0000-00000000d001');
select booking_cancel('individual', (select id from ids where k = 'i4'), '00000000-0000-0000-0000-00000000d001');
select booking_cancel('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select is((select count(*)::int from booking_cancellations), 0, 'родитель историю отмен не видит');
select throws_ok($$select booking_cancel_keep((select id from booking_cancellations limit 1))$$, '42501', 'forbidden', 'родитель решение не принимает');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from booking_cancellations where status = 'awaiting'), 4, 'четыре оплаченные отмены ждут решения');
select is((select sum(amount) from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i1')), 50.00, 'оплата в журнале осталась');

-- оставить клубу
select booking_cancel_keep((select id from booking_cancellations where session_id = (select id from ids where k = 'i1')), 'опоздали');
select is((select status from booking_cancellations where session_id = (select id from ids where k = 'i1')), 'kept', 'оплата оставлена клубу');
select is((select sum(amount) from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i1')), 50.00, 'журнал при «оставить» не меняется');
select throws_ok($$select booking_cancel_keep((select id from booking_cancellations where session_id = (select id from ids where k = 'i1')))$$, '22023', 'already decided', 'повторное решение отклоняется');

-- возврат
select booking_cancel_refund((select id from booking_cancellations where session_id = (select id from ids where k = 'i3')));
select is((select status from booking_cancellations where session_id = (select id from ids where k = 'i3')), 'refunded', 'возврат оформлен');
select is((select sum(amount) from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i3')), 0.00, 'возврат — строка с минусом, итог по занятию 0');
select is((select count(*)::int from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i3') and amount > 0), 1, 'исходная оплата не изменена');

-- перенос: на i2 (не оплачена, та же сумма)
select is((select session_id from booking_transfer_targets((select id from booking_cancellations where session_id = (select id from ids where k = 'i4')))), (select id from ids where k = 'i2'), 'в целях переноса только неоплаченная запись на ту же сумму');
reset role;
update individual_bookings set amount = 70 where session_id = (select id from ids where k = 'i2');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select booking_cancel_transfer((select id from booking_cancellations where session_id = (select id from ids where k = 'i4')), 'individual', (select id from ids where k = 'i2'))$$, '22023', 'amount mismatch', 'другая сумма — перенос отклоняется');
reset role;
update individual_bookings set amount = 50 where session_id = (select id from ids where k = 'i2');
select as_user('00000000-0000-0000-0000-0000000000a1');
select booking_cancel_transfer((select id from booking_cancellations where session_id = (select id from ids where k = 'i4')), 'individual', (select id from ids where k = 'i2'), 'на следующее');
select is((select paid from individual_bookings where session_id = (select id from ids where k = 'i2')), true, 'на новом занятии запись оплачена');
select is((select coalesce(sum(amount), 0) from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i4')), 0.00, 'на старом занятии оплата снята минусом');
select is((select sum(amount) from service_payments where kind = 'individual' and ref_id = (select id from ids where k = 'i2')), 50.00, 'на новом занятии оплата записана плюсом');

-- дополнительная: отмена клубом переводит записи в историю отмен
select extra_cancel_session((select id from ids where k = 'x1'), 'нет зала');
select is((select count(*)::int from booking_cancellations where session_id = (select id from ids where k = 'x1')), 1, 'отмена занятия клубом: запись родителя уже в истории, второй не появилась');

select * from finish();
rollback;
