-- pgTAP: очередь ожидания (0149, #274, PR 6). Даты в 2099 году.
begin;
create extension if not exists pgtap;
select plan(18);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9802, 'Родитель 1 (двое детей)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9803, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9804, 'Родитель 3 (общий выключатель выключен)', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b3';
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1', '');

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session('2099-11-07', '19:00', false, 'Тема');
insert into ids select 'i2', ind_create_session('2099-11-08', '19:00', false, 'Тема');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');

-- есть свободное место: в очередь встать нельзя
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select waitlist_join('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'seat available', 'при свободном месте в очередь не встают');
-- чужого ребёнка в очередь не поставить
select throws_ok($$select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'чужого ребёнка в очередь поставить нельзя');
-- мест нет: две позиции
select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
select as_user('00000000-0000-0000-0000-0000000000b1');
select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004');
select is((select pos || '/' || total || '/' || offer from waitlist_board() where player_id = '00000000-0000-0000-0000-00000000d004'), '2/2/false', 'родитель видит позицию 2 из 2, предложения пока нет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select string_agg(name, ',' order by pos) from waitlist_session((select id from ids where k = 'i1'))), 'Боря,Гриша', 'администратор видит очередь по порядку');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select waitlist_session((select id from ids where k = 'i1'))$$, '42501', 'forbidden', 'родитель очередь занятия не читает');

-- родитель отменяет запись: уведомление получают все в очереди сразу, одно на семью
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select count(*)::int from notifications where kind = 'waitlist_offer'), 2, 'место освободилось: сообщение получили оба родителя из очереди');
select ok((select text from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b1') like 'Освободилось место: Гриша — Индивидуальная тренировка, сб 07.11 19:00.%', 'в тексте ребёнок и занятие');

-- первый подтвердивший получает место, второй получает «мест нет»
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select offer from waitlist_board() where player_id = '00000000-0000-0000-0000-00000000d002'), true, 'при свободном месте у позиции есть предложение');
select waitlist_claim('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select waitlist_claim('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004')$$, '22023', 'session full', 'второй подтвердивший места не получает');
reset role;
select ok(exists (select 1 from individual_bookings where session_id = (select id from ids where k = 'i1') and player_id = '00000000-0000-0000-0000-00000000d002'), 'место у первого');
select ok(not exists (select 1 from booking_waitlist where player_id = '00000000-0000-0000-0000-00000000d002') and exists (select 1 from booking_waitlist where player_id = '00000000-0000-0000-0000-00000000d004'), 'первый вышел из очереди, второй остался');

-- перенос: оставшемуся в очереди приходит сообщение, позиция сохраняется
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_edit_session((select id from ids where k = 'i1'), '2099-11-07', '18:00', 'Тема');
reset role;
select is((select count(*)::int from notifications where kind = 'waitlist_moved' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'перенос занятия: очередь уведомлена, позиция сохранена');

-- админ убрал запись: очередь снова получает предложение
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_remove_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select count(*)::int from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'удаление записи админом снова предлагает место');

-- запись напрямую убирает из очереди; выход из очереди
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004');
reset role;
select is((select count(*)::int from booking_waitlist), 0, 'записанный ребёнок исчез из очереди');
select as_user('00000000-0000-0000-0000-0000000000b2');
select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
select waitlist_leave('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select count(*)::int from booking_waitlist), 0, 'родитель вышел из очереди');

-- дополнительная: рост вместимости предлагает место; отмена тренировки закрывает очередь
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x1', extra_create_session('2099-12-01', 10, 'Зал', array['00000000-0000-0000-0000-0000000000e1']::uuid[], null);
select extra_set_capacity((select id from ids where k = 'x1'), 1);
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select waitlist_join('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'not eligible', 'не из целевой группы в очередь не встанет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select waitlist_join('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d004');
reset role;
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_capacity((select id from ids where k = 'x1'), 2);
reset role;
select is((select count(*)::int from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'рост вместимости предлагает место очереди');
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_cancel_session((select id from ids where k = 'x1'), 'Дождь');
reset role;
select is((select count(*)::int from booking_waitlist), 0, 'отмена тренировки закрывает очередь');

select * from finish();
rollback;
