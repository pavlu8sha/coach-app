-- pgTAP: целевые группы и приглашения на дополнительные тренировки (0146, #274, PR 4).
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9703, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9704, 'Родитель 3 (согласие отозвано)', false),
  ('00000000-0000-0000-0000-0000000000c1', 9705, 'Тренер', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня U9', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря U11', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера U9', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now(), null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now(), null),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now(), now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'g', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал', array['00000000-0000-0000-0000-0000000000e1']::uuid[], null);
insert into ids select 'legacy', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 4, 20, 'Старое');
select is((select targeted from extra_sessions where id = (select id from ids where k = 'g')), true, 'занятие с группой — с ограничением допуска');
select is((select targeted from extra_sessions where id = (select id from ids where k = 'legacy')), false, 'занятие без целей открыто для всех, как раньше');

-- родитель из целевой группы видит и записывается; чужой — нет
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select eligible::text from booking_board() where session_id = (select id from ids where k = 'g')), '["00000000-0000-0000-0000-00000000d001"]', 'родителю целевой группы доступен его ребёнок');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d001')$$, 'ребёнок целевой группы записывается');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from booking_board() where session_id = (select id from ids where k = 'g')), 0, 'родитель ребёнка другой группы занятие не видит');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'not eligible', 'и записаться не может');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'legacy'), '00000000-0000-0000-0000-00000000d002')$$, 'на занятие без целей записаться можно');
select throws_ok($$select extra_target_player((select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d002', true)$$, '42501', 'forbidden', 'родитель приглашать не может');

-- администратор приглашает персонально
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select extra_target_player((select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d002', true)), 0, 'приглашение добавлено, записанных без допуска нет');
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d002')$$, 'приглашённый записывается');

-- получатели уведомлений: целевая группа и приглашённые, без отозванного согласия
select as_user('00000000-0000-0000-0000-0000000000a1');
reset role;
select is((select string_agg(user_id::text, ',' order by user_id) from extra_recipients((select id from ids where k = 'g'))),
  '00000000-0000-0000-0000-0000000000b1,00000000-0000-0000-0000-0000000000b2', 'получатели: группа и приглашённые, отозвавший согласие исключён');
select is((select count(*)::int from extra_recipients((select id from ids where k = 'legacy'))), 0, 'у занятия без целей рассылки нет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from extra_recipients((select id from ids where k = 'g'))$$, '42501', null, 'список получателей из приложения закрыт');

-- смена группы: запись сохраняется, админ и тренер видят, новая запись закрыта
reset role;
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d001';
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select player_id from extra_ineligible((select id from ids where k = 'g'))), '00000000-0000-0000-0000-00000000d001'::uuid, 'тренер видит записанного, сменившего группу');
reset role;
select is((select count(*)::int from extra_bookings where session_id = (select id from ids where k = 'g') and player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'запись сохранилась после смены группы');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select extra_target_group((select id from ids where k = 'g'), '00000000-0000-0000-0000-0000000000e2', true)$$, '42501', 'forbidden', 'тренер цели не меняет');
select is((select count(*)::int from extra_session_groups), 1, 'тренер список целей читает');
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_cancel('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d001');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'not eligible', 'после смены группы записаться заново нельзя');

-- убрать группу: записи не удаляются, возвращается число потерявших допуск
select as_user('00000000-0000-0000-0000-0000000000a1');
reset role;
update players set group_id = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000d001';
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_signup('extra', (select id from ids where k = 'g'), '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select extra_target_group((select id from ids where k = 'g'), '00000000-0000-0000-0000-0000000000e1', false)), 1, 'при удалении группы предупреждение: один записанный без допуска');
select is((select count(*)::int from extra_bookings where session_id = (select id from ids where k = 'g')), 2, 'записи при удалении группы не удалены');
select is((select count(*)::int from extra_activity where action = 'target_group_removed'), 1, 'удаление группы попало в журнал');
select extra_cancel_session((select id from ids where k = 'g'), 'тест');
select throws_ok($$select extra_target_group((select id from ids where k = 'g'), '00000000-0000-0000-0000-0000000000e2', true)$$, '55000', 'session cancelled', 'у отменённого занятия цели не меняются');

select * from finish();
rollback;
