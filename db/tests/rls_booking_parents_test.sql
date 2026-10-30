-- pgTAP: запись родителей на индивидуальные, вратарские и дополнительные тренировки (0045).
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9002, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9003, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000c1', 9004, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня Первая', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря Второй', 'active');
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
insert into ids select 'ind', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тест');
insert into ids select 'past', extra_create_session((now() at time zone 'Asia/Tbilisi')::date - 2, 20, 'Зал');
insert into ids select 'extra', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 5, 20, 'Зал');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select * from booking_board()$$, '42501', 'forbidden', 'тренер без детей доску записи не видит');

select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001')$$, 'родитель записывает своего ребёнка');
select throws_ok($$select booking_signup('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002')$$, '42501', 'forbidden', 'чужого ребёнка записать нельзя');
select throws_ok($$select booking_signup('goalkeeper', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001')$$, 'P0002', 'session not found', 'вид занятия должен совпадать');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'past'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session in the past', 'на прошедшее занятие записаться нельзя');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select booked->>0 from booking_board() where kind = 'individual'), 'Аня Первая', 'другой родитель видит, кто записан');
select is((select jsonb_array_length(mine) from booking_board() where kind = 'individual'), 0, 'но оплату чужого ребёнка не видит');

reset role;
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select booking_signup('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'session full', 'мест больше нет');

select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select (mine->0->>'paid')::boolean from booking_board() where kind = 'individual'), true, 'родитель видит оплату своего ребёнка');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'booking is paid', 'оплаченную запись родитель не отменяет');

select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001', false);
reset role;
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'booking.cancelHours', '100');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'too late', 'окно отмены включается настройкой');

reset role;
delete from club_settings where key = 'booking.cancelHours';
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_cancel('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001');
select is((select count(*)::int from individual_bookings), 0, 'без ограничения запись отменяется в любое время');

select booking_signup('extra', (select id from ids where k = 'extra'), '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select count(*)::int from extra_bookings), 1, 'на дополнительную тренировку родитель записывает так же');

select * from finish();
rollback;
