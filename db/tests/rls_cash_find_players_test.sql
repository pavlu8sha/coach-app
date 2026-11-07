-- pgTAP: поиск игрока в кассе (0154). Локальный админ, он же тренер (Гио), находит только игроков своих локаций,
-- хотя как тренер читает всех игроков клуба (0042). Глобальный админ находит всех; тренер без локаций и посторонний получают отказ.
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9302, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000c2', 9303, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000f1', 9304, 'Посторонний', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'Isani', 'Isani'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Красный парк');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня Исани', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Аня Парк', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', null, 'Аня Без группы', 'active');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e3');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Isani');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from players), 3, 'Гио как тренер читает всех игроков (0042)');
select is((select count(*)::int from cash_find_players('Аня')), 1, 'в кассе Гио находит только игрока своей локации');
select is((select full_name from cash_find_players('Аня')), 'Аня Исани', 'это игрок Isani');
select is((select count(*)::int from cash_find_players('Парк')), 0, 'игрока Красного парка в кассе Гио не находит');
select is((select count(*)::int from cash_find_players('А')), 0, 'запрос короче двух символов ничего не возвращает');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from cash_find_players('Аня')), 3, 'глобальный админ находит всех, включая игрока без группы');

select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select * from cash_find_players('Аня')$$, '42501', 'forbidden', 'тренер без локаций получает отказ');

select as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select * from cash_find_players('Аня')$$, '42501', 'forbidden', 'посторонний получает отказ');

select is((select has_function_privilege('anon', 'cash_find_players(text)', 'execute')), false, 'anon не может вызывать поиск');

select * from finish();
rollback;
