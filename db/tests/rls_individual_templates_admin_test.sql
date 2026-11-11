begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Игрок', 'active');
insert into individual_templates (id, club_id, isodow, start_time, end_time, goalkeepers, active) values
  ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-00000000c001', 6, '19:00', '20:00', false, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into individual_templates (club_id, isodow, start_time) values ('00000000-0000-0000-0000-00000000c001', 7, '21:00')$$, '42501', null, 'Тренер не создаёт шаблон');
select lives_ok($$update individual_templates set start_time = '20:00' where id = '00000000-0000-0000-0000-0000000000e0'$$, 'Тренер не получает ошибку при попытке изменить шаблон');
select lives_ok($$update individual_templates set active = false where id = '00000000-0000-0000-0000-0000000000e0'$$, 'Тренер не получает ошибку при попытке отключить шаблон');
select throws_ok($$delete from individual_templates where id = '00000000-0000-0000-0000-0000000000e0'$$, '42501', null, 'Тренер не удаляет шаблон');
select is((select count(*)::int from individual_templates), 0, 'Тренер не видит шаблоны');
reset role;
select is((select start_time from individual_templates where id = '00000000-0000-0000-0000-0000000000e0'), '19:00'::time, 'Тренер не изменил время начала');
select is((select active from individual_templates where id = '00000000-0000-0000-0000-0000000000e0'), true, 'Тренер не отключил шаблон');
select is((select count(*)::int from individual_templates), 1, 'Тренер не удалил шаблон');
update individual_templates set active = false where id = '00000000-0000-0000-0000-0000000000e0';

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into individual_templates (id, club_id, isodow, start_time, end_time, goalkeepers, active) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 5, '19:00', '20:00', false, true)$$, 'Админ создаёт шаблон');
select throws_ok($$insert into individual_templates (id, club_id, isodow, start_time) values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 8, '19:00')$$, '23514', null, 'День вне 1–7 отклоняется');
select throws_ok($$insert into individual_templates (id, club_id, isodow, start_time, end_time) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 5, '20:00', '19:00')$$, '23514', null, 'Окончание не позже начала отклоняется');
select throws_ok($$insert into individual_templates (id, club_id, isodow, start_time) values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c001', 5, null)$$, '23502', null, 'Пустое начало отклоняется');
select throws_ok($$insert into individual_templates (id, club_id, isodow, start_time, goalkeepers) values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000c001', 5, '19:00', false)$$, '23505', null, 'Дубликат отклоняется');
select lives_ok($$update individual_templates set isodow = 7, start_time = '18:30', end_time = '19:30', goalkeepers = true, active = true where id = '00000000-0000-0000-0000-0000000000e1'$$, 'Админ меняет день, время, окончание и тип');
insert into individual_slot_members (template_id, player_id, month) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001', '2099-11-01');
reset role;
select is(ind_autocreate('2099-11-09'), 1, 'Активный шаблон создаёт занятие');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$update individual_templates set active = false where id = '00000000-0000-0000-0000-0000000000e1'$$, 'Админ отключает шаблон');
select throws_ok($$delete from individual_templates where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'Физическое удаление шаблона через API запрещено');
reset role;
select is((select active from individual_templates where id = '00000000-0000-0000-0000-0000000000e1'), false, 'Отключённый шаблон остаётся в базе');
select is((select count(*)::int from individual_sessions), 1, 'Занятия после отключения сохранены');
select is((select count(*)::int from individual_bookings), 1, 'Записи после отключения сохранены');
select is((select count(*)::int from individual_slot_members where template_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'Постоянные после отключения сохранены');
select is(ind_autocreate('2099-11-16'), 0, 'Отключённый шаблон не создаёт новые занятия');

select * from finish();
rollback;
