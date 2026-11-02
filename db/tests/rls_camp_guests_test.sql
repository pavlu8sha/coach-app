-- pgTAP: гости на сборах (0100, #337): запись, оплата, отмена, итоги кассы, доступ.
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9602, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000b2', 9603, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000c2', 9604, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 'test', now());
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Исани');
insert into camps (id, club_id, name, starts_on, ends_on, location) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', '2026-12-27', '2027-01-05', 'Исани');
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000ca', 'Стандарт', 500, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'g1', camp_register_guest('00000000-0000-0000-0000-0000000000ca', ' Гость Иван ', '+995 555 00 00 00', '00000000-0000-0000-0000-0000000000ee', null, 'M', null);
insert into ids select 'kid', camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000ee', null, 'S', null);

select is((select count(*)::int from camp_participants where id = (select id from ids where k = 'g1') and player_id is null and guest_name = 'Гость Иван' and amount = 500 and status = 'registered'), 1, 'администратор записал гостя: имя без пробелов, сумма по тарифу, player_id пуст');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'гость иван', null, '00000000-0000-0000-0000-0000000000ee', null, null, null)$$, '23505', 'already registered', 'гость с тем же именем (без учёта регистра) не записывается дважды');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', '  ', null, '00000000-0000-0000-0000-0000000000ee', null, null, null)$$, '22023', 'name required', 'имя гостя обязательно');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость Пётр', null, '00000000-0000-0000-0000-0000000000ee', -1, null, null)$$, '22023', 'bad amount', 'сумма не может быть отрицательной');

-- оплата гостя: попадает в платежи сбора и в кассовый отчёт
select lives_ok($$select camp_pay((select id from ids where k = 'g1'), 200, 'payment', current_date, 'Наличные', null)$$, 'администратор вносит оплату гостя');
select is((select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = 'g1') and player_id is null), 200::numeric, 'платёж гостя записан без игрока');
select is((cash_report(current_date, current_date)->>'total')::numeric, 200::numeric, 'оплата гостя входит в кассовый отчёт');
select lives_ok($$select camp_cancel_payment((select id from camp_payments where participant_id = (select id from ids where k = 'g1') and amount = 200))$$, 'оплату гостя можно отменить');
select is((cash_report(current_date, current_date)->>'total')::numeric, 0::numeric, 'после отмены итог кассы 0');
select lives_ok($$select camp_update_guest((select id from ids where k = 'g1'), 'Иван Гость', '')$$, 'имя гостя меняется');
select throws_ok($$select camp_update_guest((select id from ids where k = 'kid'), 'Игрок', null)$$, '22023', 'not a guest', 'у игрока клуба гостевые поля не правятся');
select throws_ok($$insert into camp_participants (camp_id, player_id, status) values ('00000000-0000-0000-0000-0000000000ca', null, 'registered')$$, '23514', null, 'строка без игрока и без имени гостя отвергается');

-- локальный администратор: видит гостей своей локации и вносит оплату, но не записывает
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_participants where player_id is null), 1, 'локальный администратор видит гостей сбора своей локации');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость Пётр', null, '00000000-0000-0000-0000-0000000000ee', null, null, null)$$, '42501', 'forbidden', 'локальный администратор гостя не записывает');

-- родитель и тренер гостей и их платежей не видят
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from camp_participants where player_id is null) + (select count(*)::int from camp_payments where player_id is null), 0, 'родитель гостей и их платежей не видит');
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from camp_participants), 0, 'тренер участников сбора не видит');

select * from finish();
rollback;
