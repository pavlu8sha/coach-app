-- pgTAP: статус игрока (занимается / пауза / ушёл): меняет только администратор, журнал и даты, долг не считается на паузе.
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8002, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'paused', '2026-11-02', null, null)$$, '42501', null, 'тренер не меняет статус');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'paused', '2026-11-02', '2026-12-01', 'болеет')$$, 'админ ставит паузу с датой возврата');
select is((select status from players), 'paused', 'статус «пауза»');
select is((select ends_on from players), null, 'на паузе даты ухода нет');
select is((select until_on from player_status_log), '2026-12-01'::date, 'плановая дата возврата в журнале');
select lives_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'active', '2026-12-01', null, null)$$, 'возврат в группу');
select is((select starts_on from players), '2026-12-01'::date, 'при возврате дата начала проставлена, если её не было');
select lives_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'inactive', '2027-01-15', null, 'переехали')$$, 'игрок ушёл');
select is((select ends_on from players), '2027-01-15'::date, 'дата окончания проставлена');
select is((select count(*)::int from player_status_log), 3, 'в журнале три записи');
select throws_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'gone', '2027-01-15', null, null)$$, 'P0001', 'invalid status', 'неверный статус отклоняется');
select throws_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'inactive', '2027-01-15', '2027-02-01', null)$$, 'P0001', 'invalid return date', 'дата возврата только у паузы');
select lives_ok($$select player_set_status('00000000-0000-0000-0000-00000000d001', 'active', null, null, null)$$, 'вернули без даты: берётся сегодняшний день');
select is((select ends_on from players), null, 'при возврате дата окончания снята');

select * from finish();
rollback;
