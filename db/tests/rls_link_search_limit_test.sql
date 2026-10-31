-- pgTAP: ограничение частоты поиска ребёнка для привязки (S-01, миграция 0065).
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9201, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 9202, 'Родитель Б', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванова Анна'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c002', null, 'Иванченко Олег');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from search_players_for_link('Иван')), 2, 'поиск работает в пределах лимита');
select is((select count(*)::int from search_players_for_link('Иванч')), 0, 'игрок другого клуба в поиске не виден');
select lives_ok($sql$do $$ begin for i in 1..28 loop perform * from search_players_for_link('Иван'); end loop; end $$$sql$, 'ещё 28 поисков за окно проходят (всего 30 с учётом двух выше)');
select throws_ok($$select * from search_players_for_link('Иван')$$, '54000', 'search limit reached', 'тридцать первый поиск за окно отклоняется');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from search_players_for_link('Иван')), 2, 'лимит считается отдельно по пользователю');

select is((select provolatile::text from pg_proc where oid = 'search_players_for_link(text)'::regprocedure), 'v', 'поиск пишет счётчик, поэтому функция volatile: stable падает в read-only транзакции API (0087)');

select * from finish();
rollback;
