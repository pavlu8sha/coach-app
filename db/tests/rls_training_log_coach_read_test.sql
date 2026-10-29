-- pgTAP: тренер читает журнал тренировок (0079), но не пишет в него.
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8802, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 8803, 'Родитель', false);
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
select tl_confirm('2026-10-05', 'U9', 'Групповая', '17:00', '18:30', 'Зал', array['Павел', 'Соприк']);

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from training_log), 2, 'тренер видит часы всех тренеров');
select throws_ok($$select tl_confirm('2026-10-06', 'U9', 'Групповая', '17:00', '18:00', null, array['Павел'])$$, '42501', 'forbidden', 'тренер не подтверждает тренировки');
select throws_ok($$select tl_set_held((select id from training_log limit 1), false)$$, '42501', 'forbidden', 'тренер не снимает тренировки');
select throws_ok($$select tl_edit_session('2026-10-05', 'U9', '17:00', '17:30', null, 'Двор')$$, '42501', 'forbidden', 'тренер не правит время и место');
select throws_ok($$insert into training_log (club_id, external_id, held_on, coach, group_label, kind) values ('00000000-0000-0000-0000-00000000c001', 'x', '2026-10-07', 'Павел', 'U9', 'Групповая')$$, '42501', null, 'прямая вставка запрещена');
update training_log set hours = 99;
select is((select count(*)::int from training_log where hours = 99), 0, 'прямая правка не затрагивает строки');
delete from training_log;
select is((select count(*)::int from training_log), 2, 'прямое удаление не затрагивает строки');

select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from training_log), 0, 'родитель журнал не видит');

select * from finish();
rollback;
