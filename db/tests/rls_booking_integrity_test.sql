-- pgTAP: надёжность записи на тренировки (0141, #274): статус ребёнка, начало дополнительной тренировки, постоянные не больше мест.
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9102, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9103, 'Родитель 2', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня Активная', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря На паузе', 'paused'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вера Активная', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'ind', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тест');
insert into ids select 'xnow', extra_create_session((now() at time zone 'Asia/Tbilisi')::date, 20, 'Зал');
insert into ids select 'xlater', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 1, 20, 'Зал');
reset role;
-- у сегодняшней дополнительной время начала 00:00 (уже прошло), у завтрашней времени нет: запись открыта до конца дня
update extra_sessions set starts_time = time '00:00' where id = (select id from ids where k = 'xnow');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_signup('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'player not active', 'ребёнка на паузе родитель не записывает');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001')$$, 'активного ребёнка записывает');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'xlater'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'player not active', 'на дополнительную ребёнка на паузе тоже нельзя');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'xlater'), '00000000-0000-0000-0000-00000000d001')$$, 'на дополнительную без времени начала записаться можно (до конца дня)');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'xnow'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session in the past', 'после времени начала на дополнительную не записать');

-- администратор: постоянным нельзя назначить игрока на паузе
reset role;
insert into individual_templates (id, club_id, isodow, start_time, goalkeepers) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 6, '19:00', false);
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d002', current_date, true)$$, '22023', 'player not active', 'игрока на паузе постоянным не назначить');

-- постоянных больше мест: предупреждение
reset role;
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1', '');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001', current_date, true);
select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d003', current_date, true);
select is((select regulars || '/' || cap from ind_regulars_overflow(current_date)), '2/1', 'два постоянных на одно место попадают в предупреждение');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from ind_regulars_overflow(current_date)$$, '42501', null, 'родитель предупреждения не видит');

select * from finish();
rollback;
