-- pgTAP: время индивидуальных и пересечения (0150, #274, PR 7). Даты в 2099 году.
begin;
create extension if not exists pgtap;
select plan(13);

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

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session('2099-11-07', '19:00', false, 'Тема', '20:00');
select throws_ok($$select ind_create_session('2099-11-08', '19:00', false, 'Тема', '18:00')$$, '22023', 'end before start', 'окончание не раньше начала');
insert into ids select 'old', ind_create_session('2099-11-14', '19:00', false, 'Без окончания');
insert into ids select 'i2', ind_create_session('2099-11-07', '19:30', false, 'Пересекается', '20:30');
insert into ids select 'i3', ind_create_session('2099-11-07', '20:00', false, 'Встык', '21:00');
reset role;
select is((select ends_at::text from individual_sessions where id = (select id from ids where k = 'i1')), '2099-11-07 20:00:00', 'окончание сохранено');
select is((select ends_at from individual_sessions where id = (select id from ids where k = 'old')), null, 'у занятия без окончания его нет');

-- правка окончания
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_edit_session((select id from ids where k = 'old'), '2099-11-14', '19:00', 'Без окончания', null, '19:45');
select throws_ok($$select ind_edit_session((select id from ids where k = 'old'), '2099-11-14', '19:00', 'x', null, '18:00')$$, '22023', 'end before start', 'правка: окончание не раньше начала');
reset role;
select is((select ends_at::text from individual_sessions where id = (select id from ids where k = 'old')), '2099-11-14 19:45:00', 'правка задала окончание');

-- доска записи отдаёт окончание
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'bd', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '12:00', false, 'Доска', '13:00');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select to_char(ends_at, 'HH24:MI') from booking_board() where session_id = (select id from ids where k = 'bd')), '13:00', 'родитель видит окончание на доске');

-- пересечения: ребёнок записан на i1 (19:00–20:00)
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from booking_conflicts('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001')), 1, 'занятие 19:30–20:30 пересекается с 19:00–20:00');
select is((select count(*)::int from booking_conflicts('individual', (select id from ids where k = 'i3'), '00000000-0000-0000-0000-00000000d001')), 0, 'занятие встык не пересекается');
select throws_ok($$select * from booking_conflicts('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, '42501', 'forbidden', 'чужого ребёнка проверять нельзя');

-- групповая тренировка и матч
reset role;
insert into sessions (group_id, starts_at, kind) values ('00000000-0000-0000-0000-0000000000e1', '2099-11-07 19:40:00+04', 'training');
insert into matches (id, club_id, played_on, team, opponent, lifecycle_status, starts_at)
  values ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000c001', '2099-11-07', 'U9', 'Динамо', 'published', '2099-11-07 19:50:00+04');
insert into match_invitations (match_id, club_id, player_id) values ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select string_agg(kind, ',' order by kind) from booking_conflicts('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001')), 'individual,match,training', 'видны индивидуальная, групповая тренировка и матч');

-- дополнительная без времени и событие без окончания считаются точкой
reset role;
update individual_sessions set ends_at = null where id = (select id from ids where k = 'i1');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from booking_conflicts('individual', (select id from ids where k = 'i3'), '00000000-0000-0000-0000-00000000d001')), 0, 'занятие без окончания (19:00) не пересекается с 20:00');
select is((select count(*)::int from booking_conflicts('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001') where kind = 'individual'), 0, 'занятие без окончания (19:00) не пересекается с 19:30');

-- автосоздание берёт окончание из шаблона
reset role;
insert into individual_templates (id, club_id, isodow, start_time, end_time, goalkeepers) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 6, '17:00', '18:15', false);
select ind_autocreate('2099-11-20');
select is((select ends_at::time::text from individual_sessions where auto and starts_at::time = '17:00' limit 1), '18:15:00', 'автосозданное занятие получило окончание шаблона');

select * from finish();
rollback;
