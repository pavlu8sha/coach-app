-- pgTAP: имя, основная позиция и игровой номер (0209, #654 этап 1).
-- Условия: docs/PLAYER_PROFILE_ATTRIBUTES_ACCEPTANCE.md.
begin;
create extension if not exists pgtap;
select plan(42);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9402, 'Тренер U7-A', false),
  ('00000000-0000-0000-0000-0000000000c2', 9403, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9404, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b2', 9405, 'Родитель Бори', false),
  ('00000000-0000-0000-0000-0000000000d1', 9406, 'Аня (ребёнок)', false),
  ('00000000-0000-0000-0000-0000000000f1', 9407, 'Посторонний', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U7-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U7-B'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c001', 'U13-B'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000c001', 'U13-C'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000c001', 'U13-A'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-00000000c001', 'Индивидуальные / вратарские');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e4', 'Глеб', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e5', 'Дина', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e6', 'Егор', 'active'),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e7', 'Женя', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into child_links (user_id, player_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000d001');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Команда и сезон.
select is(player_team('U7-A'), 'U7', 'U7-A входит в команду U7');
select is(player_team('U7-B'), 'U7', 'U7-B входит в команду U7');
select is(player_team('U13-A'), 'U13-A', 'U13-A отдельная команда');
select is(player_team('U13-B'), 'U13-B/C', 'U13-B входит в U13-B/C');
select is(player_team('U13-C'), 'U13-B/C', 'U13-C входит в U13-B/C');
select is(player_team('Индивидуальные / вратарские'), null::text, 'некомандная группа без команды');
select is(current_season_start('2026-08-31'), '2025-09-01'::date, 'до 1 сентября — прошлый сезон');
select is(current_season_start('2026-09-01'), '2026-09-01'::date, '1 сентября начинается новый сезон');
select is(current_season_start('2027-01-15'), '2026-09-01'::date, 'январь — сезон с прошлого сентября');
select ok(has_function_privilege('authenticated', 'player_team(text)', 'execute'), 'authenticated может определить команду');
select ok(not has_function_privilege('anon', 'player_team(text)', 'execute'), 'anon не может определить команду');
select ok(not has_function_privilege('authenticated', 'player_team_of(uuid)', 'execute'), 'player_team_of не доступна клиенту');

-- Профили созданы триггером для всех игроков, без разбора full_name.
select is((select count(*)::int from player_profiles), 7, 'профиль создан для каждого игрока');
select is((select count(*)::int from player_profiles where first_name is null and last_name is null), 7, 'старые имена не разбираются автоматически');

-- Чтение: только админ, тренер текущей группы, родитель и сам ребёнок.
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from player_profiles), 7, 'администратор видит все профили');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from player_profiles), 1, 'тренер U7-A видит только свою текущую группу');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from player_profiles), 1, 'родитель видит только своего ребёнка');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from player_profiles), 1, 'ребёнок видит свой профиль');
select as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from player_profiles), 0, 'посторонний не видит профили');

-- Запись: только администратор.
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into player_profiles (player_id, first_name) values ('00000000-0000-0000-0000-00000000d002', 'Чужой')$$, '42501', null, 'тренер не может создать профиль');
select as_user('00000000-0000-0000-0000-0000000000b1');
update player_profiles set first_name = 'Подмена' where player_id = '00000000-0000-0000-0000-00000000d001';
select is((select first_name from player_profiles where player_id = '00000000-0000-0000-0000-00000000d001'), null::text, 'родитель не может изменить профиль');
select throws_ok($$insert into player_profile_history (player_id, field, new_value) values ('00000000-0000-0000-0000-00000000d001', 'first_name', 'X')$$, '42501', null, 'прямая запись в историю запрещена');

-- Номер: только командная группа, уникален в команде и сезоне.
select as_user('00000000-0000-0000-0000-0000000000a1');
update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d001';
select is((select jersey_number from player_profiles where player_id = '00000000-0000-0000-0000-00000000d001'), 10, 'номер сохранён');
select is((select jersey_team from player_profiles where player_id = '00000000-0000-0000-0000-00000000d001'), 'U7', 'номер привязан к команде U7');
select is((select jersey_season_start from player_profiles where player_id = '00000000-0000-0000-0000-00000000d001'), current_season_start(tbilisi_day(now())), 'номер привязан к текущему сезону');
select is((select count(*)::int from player_jersey_history where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null), 1, 'действующий номер попал в историю');
select throws_ok($$update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d003'$$, '23505', null, 'номер занят в той же команде U7');
update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d004';
select is((select jersey_team from player_profiles where player_id = '00000000-0000-0000-0000-00000000d004'), 'U13-B/C', 'U13-B получает команду U13-B/C');
select throws_ok($$update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d005'$$, '23505', null, 'номер занят в U13-B/C');
update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d006';
select is((select jersey_team from player_profiles where player_id = '00000000-0000-0000-0000-00000000d006'), 'U13-A', 'U13-A — отдельная команда, номер 10 свободен');
select throws_ok($$update player_profiles set jersey_number = 10 where player_id = '00000000-0000-0000-0000-00000000d007'$$, '22023', null, 'некомандной группе номер недоступен');

-- Смена номера закрывает старую строку истории.
update player_profiles set jersey_number = 11 where player_id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from player_jersey_history where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null), 1, 'у игрока один действующий номер');
select is((select count(*)::int from player_jersey_history where player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'старый номер остался в истории');
select is((select count(*)::int from player_jersey_history where player_id = '00000000-0000-0000-0000-00000000d001' and number = 10 and valid_to is not null), 1, 'старый номер закрыт');

-- Переход внутри команды сохраняет номер, переход в другую команду очищает.
update player_profiles set jersey_number = 12 where player_id = '00000000-0000-0000-0000-00000000d003';
update players set group_id = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000d003';
select is((select jersey_number from player_profiles where player_id = '00000000-0000-0000-0000-00000000d003'), 12, 'U7-B -> U7-A сохраняет номер');
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d001';
select is((select jersey_number from player_profiles where player_id = '00000000-0000-0000-0000-00000000d001'), null::int, 'переход U7 -> U9 очищает номер');
select is((select count(*)::int from player_jersey_history where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null), 0, 'при смене команды номер закрыт');

-- Имя и история изменений.
update player_profiles set first_name = 'Аня', last_name = 'Петрова' where player_id = '00000000-0000-0000-0000-00000000d001';
select is((select full_name from players where id = '00000000-0000-0000-0000-00000000d001'), 'Петрова Аня', 'full_name собирается как «Фамилия Имя»');
update player_profiles set last_name = null, first_name = 'Анна' where player_id = '00000000-0000-0000-0000-00000000d001';
select is((select full_name from players where id = '00000000-0000-0000-0000-00000000d001'), 'Петрова Аня', 'без фамилии full_name не перезаписывается');
select ok(exists (select 1 from player_profile_history where player_id = '00000000-0000-0000-0000-00000000d001' and field = 'first_name' and old_value = 'Аня' and new_value = 'Анна'), 'история имени хранит старое и новое значение');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from player_profile_history), 0, 'родитель не видит историю изменений');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ok((select count(*) from player_profile_history) > 0, 'администратор видит историю изменений');

select * from finish();
rollback;
