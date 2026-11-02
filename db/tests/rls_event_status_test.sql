-- pgTAP: статус события — меняет только администратор, event_list отдаёт статус, новое событие идёт.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8002, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select event_create('championship', 'U9', 'Ч1', '2026-11-01', 0, null)$$, 'тренер создаёт событие');
select is((select status from event_list() limit 1), 'active', 'новое событие идёт');
select throws_ok($$select event_set_status((select id from event_list() limit 1), 'finished')$$, '42501', null, 'тренер не меняет статус');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select event_set_status((select id from event_list() limit 1), 'finished')$$, 'админ завершает событие');
select is((select status from event_list() limit 1), 'finished', 'статус виден в списке');
select throws_ok($$select event_set_status((select id from event_list() limit 1), 'done')$$, 'P0001', 'invalid status', 'неверный статус отклоняется');
select lives_ok($$select event_set_status((select id from event_list() limit 1), 'active')$$, 'админ возвращает событие в работу');

select * from finish();
rollback;
