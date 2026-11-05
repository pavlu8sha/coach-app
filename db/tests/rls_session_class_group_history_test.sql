-- pgTAP: тип занятия и история групп игрока (0120). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(18);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7302, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7303, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'G2');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- история групп
select is(points_group_at('00000000-0000-0000-0000-00000000d001', date '2026-01-01'), '00000000-0000-0000-0000-0000000000e1'::uuid, 'новый игрок: группа с первой даты');
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'одна строка истории');
update players set full_name = 'Аня К' where id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'правка без смены группы историю не меняет');
-- первая смена группы закрывает начальный интервал; вторая в тот же день правит открытую строку
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'первая смена: начальный интервал закрыт, открыт новый');
update players set group_id = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'вторая смена в тот же день пустых интервалов не плодит');
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d001';
select is(points_group_at('00000000-0000-0000-0000-00000000d001', tbilisi_day(now())), '00000000-0000-0000-0000-0000000000e2'::uuid, 'сегодня новая группа');

-- имитируем игрока, который давно в G2, и переводим в G1: прошлое не переписывается
update player_group_history set valid_from = tbilisi_day(now()) - 20 where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null;
update player_group_history set valid_to = tbilisi_day(now()) - 20 where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is not null;
update players set group_id = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001'), 3, 'перевод создаёт новый интервал');
select is(points_group_at('00000000-0000-0000-0000-00000000d001', tbilisi_day(now()) - 5), '00000000-0000-0000-0000-0000000000e2'::uuid, 'до перевода была прежняя группа');
select is(points_group_at('00000000-0000-0000-0000-00000000d001', tbilisi_day(now())), '00000000-0000-0000-0000-0000000000e1'::uuid, 'с дня перевода новая группа');
select is((select count(*)::int from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null), 1, 'открытая строка одна');

-- тип занятия
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select open_session_special('00000000-0000-0000-0000-0000000000e1', current_date - 1, time '18:00', 'unscheduled')$$, '42501', 'forbidden', 'родитель не открывает занятие');
select throws_ok($$select points_group_at('00000000-0000-0000-0000-00000000d001', current_date)$$, '42501', null, 'приложению группа на дату недоступна');
select is((select count(*)::int from player_group_history), 0, 'родитель не видит историю групп');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select open_session_special('00000000-0000-0000-0000-0000000000e1', current_date + 5, time '18:00', 'moved')$$, 'P0001', 'date in the future', 'будущую дату нельзя');
select throws_ok($$select open_session_special('00000000-0000-0000-0000-0000000000e1', current_date - 1, time '18:00', 'regular')$$, '22023', 'invalid class', 'обычный тип через эту функцию нельзя');
create temp table sp as select open_session_special('00000000-0000-0000-0000-0000000000e1', current_date - 1, time '18:00', 'unscheduled') as id;
grant select on sp to authenticated;
select is((select class from sessions where id = (select id from sp)), 'unscheduled', 'создана внеплановая');
select is(open_session_special('00000000-0000-0000-0000-0000000000e1', current_date - 1, time '18:00', 'unscheduled'), (select id from sp), 'повтор возвращает то же занятие');
select is((select count(*)::int from sessions where class <> 'regular'), 1, 'дубля нет');

select * from finish();
rollback;
