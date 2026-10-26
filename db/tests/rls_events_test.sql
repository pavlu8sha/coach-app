-- pgTAP: события — тренер и админ создают и ведут состав, родитель закрыт, суммы тренеру не видны.
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8003, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select event_create('championship', 'U9', 'Ч1', '2026-11-01', 10, null)$$, '42501', null, 'родитель не создаёт событие');
select throws_ok($$select * from event_list()$$, '42501', null, 'родитель не видит список событий');

select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select event_create('championship', 'U9', 'Ч1', '2026-11-01', 999, null)$$, 'тренер создаёт событие');
select lives_ok($$select event_roster_add((select id from event_list() limit 1), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'тренер добавляет состав');
select is((select players from event_list() limit 1), 2, 'счётчик игроков');
select is((select count(*)::int from event_roster((select id from event_list() limit 1))), 2, 'состав читается');
select is((select count(*)::int from tournament_fees), 0, 'таблица взносов напрямую закрыта');
select lives_ok($$select event_add_game((select id from event_list() limit 1), '2026-11-02', 'Олимп')$$, 'игра добавлена');
select is((select games from event_list() limit 1), 1, 'счётчик игр');
select lives_ok($$select event_roster_remove((select id from event_list() limit 1), '00000000-0000-0000-0000-00000000d002')$$, 'игрок убран из состава');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select fee from tournaments limit 1), 0::numeric, 'взнос, указанный тренером, игнорируется');

select * from finish();
rollback;
