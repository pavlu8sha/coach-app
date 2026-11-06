-- pgTAP: первая волна, баннер и пятничная рассылка (0151, #274, PR 8). Даты в 2099 году.
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9802, 'Родитель 1 (двое детей)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9803, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9804, 'Родитель 3 (общий выключатель выключен)', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b3';
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- не администратор
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select first_wave_add(array['ind_sat'], array['00000000-0000-0000-0000-00000000d001']::uuid[])$$, '42501', 'forbidden', 'родитель не вносит первую волну');
select throws_ok($$select * from first_wave_friday(true)$$, '42501', 'forbidden', 'родитель не запускает рассылку');

-- родитель 2 сам отключил субботу: выбор родителя администратор не перезаписывает
select as_user('00000000-0000-0000-0000-0000000000b2');
select notify_pref_set('ind_sat', false);

select as_user('00000000-0000-0000-0000-0000000000a1');
select first_wave_add(array['ind_sat'], array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[]);
select first_wave_add(array['ind_sat'], array['00000000-0000-0000-0000-00000000d001']::uuid[]); -- повтор безопасен
select is((select count(*)::int from first_wave_children), 2, 'в списке два ребёнка, повтор не плодит строк');
reset role;
select is((select enabled || '/' || source from notification_prefs where user_id = '00000000-0000-0000-0000-0000000000b1' and direction = 'ind_sat'), 'true/admin', 'родителю первой волны включена суббота');
select is((select enabled || '/' || source from notification_prefs where user_id = '00000000-0000-0000-0000-0000000000b2' and direction = 'ind_sat'), 'false/self', 'выбор родителя не перезаписан');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select string_agg(name || ':' || parents || ':' || enabled, ',' order by name) from first_wave_list()), 'Аня:1:1,Боря:1:0', 'список: родители и сколько включили');

-- предпросмотр рассылки ничего не отправляет
select is((select recipients from first_wave_friday(true) where direction = 'ind_sat'), 1, 'предпросмотр: один получатель (второй отключил)');
reset role;
select is((select count(*)::int from notifications where kind = 'first_wave_friday'), 0, 'предпросмотр ничего не ставит в очередь');

-- выключатель клуба не включён: реальный запуск тоже ничего не отправляет
select as_user('00000000-0000-0000-0000-0000000000a1');
select first_wave_friday(false);
reset role;
select is((select count(*)::int from notifications where kind = 'first_wave_friday'), 0, 'пока booking.notify не включён, рассылки нет');

-- включено: одно сообщение, повтор безопасен
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', '');
select as_user('00000000-0000-0000-0000-0000000000a1');
select first_wave_friday(false);
select first_wave_friday(false);
reset role;
select is((select count(*)::int from notifications where kind = 'first_wave_friday' and user_id = '00000000-0000-0000-0000-0000000000b1' and text like '%Аня%'), 1, 'рассылка: одно сообщение, повторный запуск не дублирует');

-- ребёнок с записью по направлению исключается
select as_user('00000000-0000-0000-0000-0000000000a1');
select first_wave_add(array['goalkeeper'], array['00000000-0000-0000-0000-00000000d002']::uuid[]);
insert into ids select 'g1', ind_create_session('2099-11-07', '12:00', true, 'Вратари');
select ind_add_player((select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002');
select is((select recipients from first_wave_friday(true) where direction = 'goalkeeper'), 0, 'ребёнок с записью на вратарскую не получает приглашение');

-- убрать ребёнка: снимается настройка, включённая администратором
select first_wave_remove('ind_sat', '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select count(*)::int from notification_prefs where user_id = '00000000-0000-0000-0000-0000000000b1' and direction = 'ind_sat'), 0, 'после удаления ребёнка настройка родителя снята');

-- баннер при первом входе
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(booking_info_pending(), true, 'родитель видит информационный баннер');
select booking_info_seen();
select is(booking_info_pending(), false, 'после «Понятно» баннер не возвращается');

select * from finish();
rollback;
