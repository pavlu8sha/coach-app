-- pgTAP: поиск ребёнка для привязки по словам и с кириллицей (миграция 0198, docs/LINK_SEARCH_WORDS_ACCEPTANCE.md).
begin;
create extension if not exists pgtap;
select plan(21);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9301, 'Родитель А', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ivanov Max', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ivanova Anna', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c002', null, 'Ivanov Maksim', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', null, 'Khachatryan Gor', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', null, 'Ivanov Oleg', 'inactive'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', null, 'Zaripov Ruslan', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function names(q text) returns text language sql as $$
  select coalesce(string_agg(full_name, ', ' order by full_name), '') from search_players_for_link(q) $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is(names('Ivanov Max'), 'Ivanov Max', 'Фамилия Имя находит ребёнка');
select is(names('Max Ivanov'), 'Ivanov Max', 'Имя Фамилия (другой порядок) находит того же ребёнка');
select is(names('Max'), 'Ivanov Max', 'одно имя находит ребёнка');
select is(names('ivanov'), 'Ivanov Max, Ivanova Anna', 'одна фамилия: регистр не важен, чужой клуб и неактивный не видны');
select is(names('Ivanov Ma'), 'Ivanov Max', 'короткое слово только сужает выдачу');
select is(names('Ma Iv'), '', 'без слова от 3 символов поиск пустой');
select is(names('Iv'), '', 'меньше 3 символов: пусто');
select is(names('  M  '), '', 'пробелы вокруг не считаются символами');
select is(names('Макс'), 'Ivanov Max', 'кириллица находит латинское имя');
select is(names('Иванов Макс'), 'Ivanov Max', 'кириллица, Фамилия Имя');
select is(names('Макс Иванов'), 'Ivanov Max', 'кириллица, Имя Фамилия');
select is(names('Хачатрян'), 'Khachatryan Gor', 'Хачатрян находит Khachatryan');
select is(names('Руслан Зарипов'), 'Zaripov Ruslan', 'Руслан Зарипов находит Zaripov Ruslan');
select is(names('ааа'), '', 'повторы букв не превращают три символа в «а», находящую всех');
select is(names('%%%'), '', 'маски не работают');
select is(names('___'), '', 'подчёркивания не маски');
select is(names('Iva Ivanov Ivanova Ivano Max'), 'Ivanova Anna', 'пять слов: берутся первые четыре, пятое («Max», которого нет у Anna) игнорируется, запрос не ломается');
reset role;
insert into link_requests (user_id, player_id, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'pending');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(names('Ivanov Max'), '', 'ребёнок с уже отправленным запросом скрыт');

reset role;
select is((select provolatile::text from pg_proc where oid = 'search_players_for_link(text)'::regprocedure), 'v', 'поиск остаётся volatile (пишет счётчик)');
select is((select provolatile::text from pg_proc where oid = 'link_search_norm(text)'::regprocedure), 'i', 'нормализация immutable');
select is(
  (select array_agg(r order by r) from (select 'anon' r where has_function_privilege('anon', 'link_search_norm(text)'::regprocedure, 'execute')
     union all select 'authenticated' where has_function_privilege('authenticated', 'link_search_norm(text)'::regprocedure, 'execute')) s),
  null, 'link_search_norm недоступна клиентам');

select * from finish();
rollback;
