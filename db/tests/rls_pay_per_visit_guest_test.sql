-- pgTAP: игрок «за визит» на тренировке чужой группы платит 20 ₾ (миграция 0201). Условия: docs/PAY_PER_VISIT_GUEST_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(20);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9911, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9912, 'Тренер U9-B', false),
  ('00000000-0000-0000-0000-0000000000b1', 9913, 'Родитель Льва', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U7-A', 'Исани');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status, pay_mode, pay_mode_from) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Fedorov Lev', 'active', 'per_visit', '2026-11-01'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Fedorov Matvey', 'active', 'per_visit', '2026-11-01'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Borya Abonement', 'active', 'subscription', null),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Pozdnyaya Data', 'active', 'per_visit', '2026-12-01');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-15 12:00+04', 'training', 'ATT|2026-11-15', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-14 12:00+04', 'training', 'ATT|2026-11-14', 'regular'),
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-0000000000e1', '2026-10-20 12:00+04', 'training', 'ATT|2026-10-20', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- У1, У3: цена гостя
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001')$$, 'У1: тренер добавляет гостя «за визит»');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d004');
select session_guest_add('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 20.00::numeric, 'У1: гость «за визит» стоит 20');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d003'), 15.00::numeric, 'У1: гость на абонементе стоит 15');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d004'), 15.00::numeric, 'У3: «за визит» с более поздней даты начала платит 15');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a0' and player_id = '00000000-0000-0000-0000-00000000d001'), 15.00::numeric, 'У3: занятие до даты начала «за визит» стоит 15');

-- У1: настройка own_visit.fee действует, прошлые строки не меняются (У4)
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'own_visit.fee', '25');
select as_user('00000000-0000-0000-0000-0000000000c1');
select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a2' and player_id = '00000000-0000-0000-0000-00000000d001'), 25.00::numeric, 'У1: цена из настройки own_visit.fee');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 20.00::numeric, 'У4: прошлая строка осталась 20');
update club_settings set value = 'abc' where key = 'own_visit.fee';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002')$$, '22023', 'invalid setting own_visit.fee: abc', 'У1: неверная own_visit.fee даёт ошибку');
select lives_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d003')$$, 'У1: игроку на абонементе неверная own_visit.fee не мешает');
reset role;
delete from club_settings where key = 'own_visit.fee';

-- У2: только цена
select is((select count(*)::int from own_visits), 0, 'У2: own_visits не создаётся');
select is((select count(*)::int from subscriptions), 0, 'У2: абонементы не создаются');
select is((select count(*)::int from attendance), 0, 'У2: attendance не меняется');

-- У2, У6: оплата и родитель
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-11-16')$$, 'У2: оплата по умолчанию принимается');
reset role;
select is((select amount from service_payments where kind = 'visit' and ref_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 20.00::numeric, 'У2: в журнале оплата 20, вид visit');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select due from parent_dues() where kind = 'visit' and on_date = '2026-11-15'), 20.00::numeric, 'У6: родитель видит посещение на 20');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select r ->> 'kind' from jsonb_array_elements(cash_report('2026-11-16', '2026-11-16') -> 'rows') r limit 1), 'Доп. посещение', 'У6: в кассе «Доп. посещение»');
reset role;

-- У5: скрипт исправления двух строк (фикстура: у обоих 15; посещение Льва оплачено, Матвея нет)
update session_guests set amount = 15 where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001';
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002');
update session_guests set amount = 15 where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002';
\i db/ops/guest-visit-fedorov-20-2026-11-16.sql
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 20.00::numeric, 'У5: скрипт поставил 20 неоплаченному посещению Матвея');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 15.00::numeric, 'У5: скрипт не трогает оплаченное посещение Льва');
\i db/ops/guest-visit-fedorov-20-2026-11-16.sql
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 20.00::numeric, 'У5: повторный запуск скрипта ничего не меняет');
select is((select count(*)::int from service_payments), 1, 'У5: платежи скриптом не создаются и не меняются');

select * from finish();
rollback;
