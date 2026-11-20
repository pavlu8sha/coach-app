-- pgTAP: атомарное сохранение карточки игрока player_save (0209, #654, условие И2.4а).
-- Условия: docs/PLAYER_PROFILE_ATTRIBUTES_ACCEPTANCE.md.
begin;
create extension if not exists pgtap;
select plan(23);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9502, 'Тренер', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U7-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Занят Номером', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Редактируемый Игрок', 'active');
update player_profiles set jersey_number = 7 where player_id = '00000000-0000-0000-0000-00000000d001';
insert into subscriptions (player_id, group_id, month) values
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', date_trunc('month', tbilisi_day(now()))::date);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Права.
select ok(has_function_privilege('authenticated', 'player_save(uuid,uuid,jsonb,jsonb)', 'execute'), 'authenticated может вызвать player_save');
select ok(not has_function_privilege('anon', 'player_save(uuid,uuid,jsonb,jsonb)', 'execute'), 'anon не может вызвать player_save');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select player_save('00000000-0000-0000-0000-00000000d002', null, '{"full_name":"Взлом Тренера","status":"active"}'::jsonb, '{}'::jsonb)$$, '42501', null, 'тренер не может сохранить карточку');
reset role;
select is((select full_name from players where id = '00000000-0000-0000-0000-00000000d002'), 'Редактируемый Игрок', 'отказ тренеру ничего не изменил');

select as_user('00000000-0000-0000-0000-0000000000a1');

-- 1. Конфликт номера при редактировании: ни players, ни профиль, ни абонемент не меняются.
select throws_ok($$select player_save('00000000-0000-0000-0000-00000000d002', null,
  '{"full_name":"Новое Имя","birth_date":"2018-05-05","group_id":"00000000-0000-0000-0000-0000000000e1","status":"inactive"}'::jsonb,
  '{"first_name":"Имя","last_name":"Новое","primary_position":"Защитник","jersey_number":7}'::jsonb)$$, '23505', null, 'PS1 конфликт номера при редактировании отклонён');
reset role;
select is((select full_name from players where id = '00000000-0000-0000-0000-00000000d002'), 'Редактируемый Игрок', 'PS1 full_name не изменился');
select is((select status from players where id = '00000000-0000-0000-0000-00000000d002'), 'active', 'PS1 статус не изменился');
select is((select birth_date from players where id = '00000000-0000-0000-0000-00000000d002'), null::date, 'PS1 дата рождения не изменилась');
select is((select primary_position from player_profiles where player_id = '00000000-0000-0000-0000-00000000d002'), null::text, 'PS1 позиция профиля не изменилась');
select is((select first_name from player_profiles where player_id = '00000000-0000-0000-0000-00000000d002'), null::text, 'PS1 имя профиля не изменилось');
select is((select count(*)::int from player_profile_history where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'PS1 истории изменений нет');

-- 2. Конфликт номера при создании: ни строки игрока, ни профиля.
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select player_save(null, '00000000-0000-0000-0000-00000000c001',
  '{"full_name":"Новый Ребёнок","group_id":"00000000-0000-0000-0000-0000000000e1","status":"active"}'::jsonb,
  '{"first_name":"Ребёнок","last_name":"Новый","jersey_number":7}'::jsonb)$$, '23505', null, 'PS2 конфликт номера при создании отклонён');
reset role;
select is((select count(*)::int from players where full_name = 'Новый Ребёнок'), 0, 'PS2 строка игрока не создана');
select is((select count(*)::int from player_profiles where last_name = 'Новый'), 0, 'PS2 пустого профиля нет');

-- Успешное создание и редактирование одной транзакцией.
select as_user('00000000-0000-0000-0000-0000000000a1');
select ok((select player_save(null, '00000000-0000-0000-0000-00000000c001',
  '{"full_name":"Свободный Номер","group_id":"00000000-0000-0000-0000-0000000000e1","status":"active"}'::jsonb,
  '{"first_name":"Номер","last_name":"Свободный","primary_position":"Вратарь","jersey_number":8}'::jsonb)) is not null, 'PS успешное создание возвращает id');
select is((select count(*)::int from players where full_name = 'Свободный Номер'), 1, 'PS игрок создан');
select is((select jersey_number::int from player_profiles where last_name = 'Свободный'), 8, 'PS номер профиля записан');
select is((player_save('00000000-0000-0000-0000-00000000d002', null,
  '{"full_name":"Редактируемый Игрок","group_id":"00000000-0000-0000-0000-0000000000e1","status":"active"}'::jsonb,
  '{"first_name":"Игрок","last_name":"Редактируемый","primary_position":"Нападающий","jersey_number":9}'::jsonb)), '00000000-0000-0000-0000-00000000d002'::uuid, 'PS успешное редактирование возвращает id');
select is((select jersey_number::int from player_profiles where player_id = '00000000-0000-0000-0000-00000000d002'), 9, 'PS номер при редактировании записан');

-- Перевод в другую группу обновляет абонемент текущего месяца.
select player_save('00000000-0000-0000-0000-00000000d002', null,
  '{"full_name":"Редактируемый Игрок","group_id":"00000000-0000-0000-0000-0000000000e2","status":"active"}'::jsonb,
  '{"first_name":"Игрок","last_name":"Редактируемый","jersey_number":null}'::jsonb);
select is((select group_id from subscriptions where player_id = '00000000-0000-0000-0000-00000000d002'), '00000000-0000-0000-0000-0000000000e2'::uuid, 'PS перевод обновил абонемент текущего месяца');

-- 4. Ошибка абонемента при переводе откатывает игрока и профиль.
reset role;
create or replace function ps_break_sub() returns trigger language plpgsql as $$
begin raise exception 'subscription update failed' using errcode = 'P0001'; end $$;
reset role;
create trigger ps_break_sub before update on subscriptions for each row execute function ps_break_sub();
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select player_save('00000000-0000-0000-0000-00000000d002', null,
  '{"full_name":"Сломанный Перевод","group_id":"00000000-0000-0000-0000-0000000000e1","status":"active"}'::jsonb,
  '{"first_name":"Сломанный","last_name":"Перевод","primary_position":"Полузащитник","jersey_number":10}'::jsonb)$$, 'P0001', 'subscription update failed', 'PS4 ошибка абонемента отклоняет сохранение');
reset role;
select is((select group_id from players where id = '00000000-0000-0000-0000-00000000d002'), '00000000-0000-0000-0000-0000000000e2'::uuid, 'PS4 группа игрока не изменилась');
select is((select last_name from player_profiles where player_id = '00000000-0000-0000-0000-00000000d002'), 'Редактируемый', 'PS4 профиль не изменился');

select * from finish();
rollback;
