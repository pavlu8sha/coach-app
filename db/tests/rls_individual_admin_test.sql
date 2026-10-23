-- pgTAP: индивидуальные и вратарские занятия для администратора (0034).
begin;
create extension if not exists pgtap;
select plan(17);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8302, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вика', 'active');
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table sid (id uuid);
grant all on sid to authenticated;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select ind_create_session('2026-11-07', '12:00', false, 'Дриблинг')$$, '42501', 'forbidden', 'тренер не создаёт занятия');

select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_regular('00000000-0000-0000-0000-00000000d001', false, true);
insert into sid select ind_create_session('2026-11-07', '12:00', false, 'Дриблинг');
select is((select count(*)::int from individual_bookings where session_id = (select id from sid)), 1, 'постоянный записан автоматически');
select is((select amount from individual_bookings where session_id = (select id from sid)), 50::numeric, 'цена по умолчанию 50');
select throws_ok($$select ind_create_session('2026-11-07', '12:00', false, 'Ещё раз')$$, '23505', 'session exists', 'дубль занятия отклоняется');
select lives_ok($$select ind_create_session('2026-11-07', '12:00', true, null)$$, 'вратарское в то же время — отдельное занятие');

select ind_add_player((select id from sid), '00000000-0000-0000-0000-00000000d002');
select throws_ok($$select ind_add_player((select id from sid), '00000000-0000-0000-0000-00000000d002')$$, '23505', 'already booked', 'дважды записать нельзя');
select throws_ok($$select ind_add_player((select id from sid), '00000000-0000-0000-0000-00000000d009')$$, '22023', 'player not in club', 'игрок чужого клуба отклоняется');

reset role;
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '2');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select ind_add_player((select id from sid), '00000000-0000-0000-0000-00000000d003')$$, '22023', 'session full', 'мест не больше лимита из настроек');

select ind_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d002', true);
select throws_ok($$select ind_remove_player((select id from sid), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'booking is paid', 'оплаченную запись убрать нельзя');
select throws_ok($$select ind_delete_session((select id from sid))$$, '22023', 'session has payments', 'занятие с оплатой удалить нельзя');
select throws_ok($$select ind_edit_session((select id from sid), '2026-11-08', '12:00', 'x')$$, '22023', 'session has payments', 'занятие с оплатой нельзя перенести');
select lives_ok($$select ind_edit_session((select id from sid), '2026-11-07', '12:00', 'Новая тема')$$, 'тему менять можно');

select ind_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d002', false);
select lives_ok($$select ind_remove_player((select id from sid), '00000000-0000-0000-0000-00000000d002')$$, 'после отмены оплаты запись убирается');
select lives_ok($$select ind_edit_session((select id from sid), '2026-11-08', '11:30', 'Перенос')$$, 'без оплат занятие переносится');
select lives_ok($$select ind_delete_session((select id from sid))$$, 'без оплат занятие удаляется');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select ind_set_paid('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d001', true)$$, '42501', 'forbidden', 'тренер не отмечает оплату');
select throws_ok($$select ind_book('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d001')$$, '42501', null, 'служебная ind_book недоступна из приложения');

select * from finish();
rollback;
