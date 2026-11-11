-- pgTAP: лимит мест на дополнительной тренировке из настройки extra.cap (0102, 0138).
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 8601, 'Админ', true);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вика', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table sid (id uuid);
grant all on sid to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
-- дата в будущем по часам клуба: доска записи показывает только предстоящие тренировки (раньше стояло 2026-11-10 и тест упал 11.11)
insert into sid select extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 7, 20, 'Зал');

-- Настройки нет — без ограничения
select lives_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d001')$$, 'без настройки лимита нет');

reset role;
insert into club_settings (club_id, key, scope, value) values ('00000000-0000-0000-0000-00000000c001', 'extra.cap', '', '2');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d002')$$, 'второе место свободно при лимите 2');
select throws_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d003')$$, '22023', 'session full', 'третьего игрока при лимите 2 записать нельзя');
select is((select count(*)::int from extra_bookings where session_id = (select id from sid)), 2, 'записей две');

-- 0 и пусто — без ограничения
reset role;
update club_settings set value = '0' where key = 'extra.cap';
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d003')$$, 'лимит 0 означает без ограничения');

-- Доска записи отдаёт лимит дополнительной тренировки
reset role;
update club_settings set value = '18' where key = 'extra.cap';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select capacity from booking_board() where session_id = (select id from sid)), 18, 'на доске видно лимит из настройки');

-- Недопустимое значение — явная ошибка, не «без ограничения» и не другой лимит
reset role;
update club_settings set value = 'abc' where key = 'extra.cap';
select throws_ok($$select extra_cap('00000000-0000-0000-0000-00000000c001')$$, '22023', 'invalid setting extra.cap: abc', 'нечисло: ошибка');
update club_settings set value = '2.5' where key = 'extra.cap';
select throws_ok($$select extra_cap('00000000-0000-0000-0000-00000000c001')$$, '22023', 'invalid setting extra.cap: 2.5', 'дробное: ошибка');
update club_settings set value = '-3' where key = 'extra.cap';
select throws_ok($$select extra_cap('00000000-0000-0000-0000-00000000c001')$$, '22023', 'invalid setting extra.cap: -3', 'отрицательное: ошибка');
update club_settings set value = '101' where key = 'extra.cap';
select throws_ok($$select extra_cap('00000000-0000-0000-0000-00000000c001')$$, '22023', 'invalid setting extra.cap: 101', 'больше 100: ошибка');
update club_settings set value = '18 мест' where key = 'extra.cap';
select throws_ok($$select extra_cap('00000000-0000-0000-0000-00000000c001')$$, '22023', 'invalid setting extra.cap: 18 мест', 'текст вокруг числа: ошибка');
update club_settings set value = '0,0' where key = 'extra.cap';
select is(extra_cap('00000000-0000-0000-0000-00000000c001'), null::int, '0,0 — без ограничения');
update club_settings set value = ' 18 ' where key = 'extra.cap';
select is(extra_cap('00000000-0000-0000-0000-00000000c001'), 18, 'пробелы вокруг целого допустимы');

reset role;
delete from club_settings where key = 'extra.cap';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select capacity from booking_board() where session_id = (select id from sid)), null::int, 'без настройки лимит на доске пустой');

reset role;
select is(has_function_privilege('authenticated', 'extra_cap(uuid)', 'execute'), false, 'extra_cap закрыта для клиентов');
select is(has_function_privilege('authenticated', 'booking_signup(text,uuid,uuid)', 'execute'), true, 'booking_signup по-прежнему доступна');

select * from finish();
rollback;
