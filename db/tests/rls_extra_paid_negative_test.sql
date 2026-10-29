-- pgTAP R-07: extra_set_paid отклоняет отрицательную сумму; нулевая, пустая и отмена работают как раньше.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9304, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table sid (id uuid);
grant all on sid to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into sid select extra_create_session('2026-11-10', 20, 'Зал');
select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d001');

select throws_ok($$select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', -5)$$, '22023', 'bad amount', 'отрицательная сумма отклоняется');
select is((select paid from extra_bookings where session_id = (select id from sid)), false, 'после отказа запись не оплачена');
select is((select paid_amount from extra_bookings where session_id = (select id from sid)), null, 'после отказа суммы нет');

select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', 0);
select is((select paid_amount from extra_bookings where session_id = (select id from sid)), 0::numeric, 'нулевая сумма принимается как раньше');
select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
select is((select paid_amount from extra_bookings where session_id = (select id from sid)), 20::numeric, 'пустая сумма — по цене тренировки');
select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', true, 'Перевод', 15);
select is((select paid_amount from extra_bookings where session_id = (select id from sid)), 15::numeric, 'положительная сумма принимается');
select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', false);
select is((select paid from extra_bookings where session_id = (select id from sid)), false, 'отмена оплаты работает');

select * from finish();
rollback;
