-- pgTAP: исправления по аудиту сборов (0188; C-03, C-04, C-05, C-09), docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 72-76.
begin;
create extension if not exists pgtap;
select plan(27);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9971, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9972, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b2', 9973, 'Родитель Бори', false),
  ('00000000-0000-0000-0000-0000000000b3', 9974, 'Родитель Васи', false),
  ('00000000-0000-0000-0000-0000000000d1', 9975, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000d2', 9976, 'Чужой локальный админ', false);
insert into location_admins (user_id, location) values
  ('00000000-0000-0000-0000-0000000000d1', 'Исани'), ('00000000-0000-0000-0000-0000000000d2', 'Сабуртало');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10');
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true);
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', '');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;
create or replace function bsend(cid uuid, k text, b text) returns jsonb language plpgsql as $$
declare pv jsonb := camp_broadcast_preview(cid, k, b);
begin
  return camp_broadcast_send(cid, k, b, (pv->>'recipients')::int, pv->>'token');
end $$;
grant execute on function bsend(uuid, text, text) to public;

-- Аня, Боря, Вася записаны родителями (по 1000, оплат нет)
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'borya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'vasya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null);

-- ===== 72. C-03: повтор напоминания =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((bsend('00000000-0000-0000-0000-0000000000ca', 'reminder', null)->>'recipients')::int, 3, 'напоминание без текста: три семьи с долгом');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'reminder', null)$$, '22023', 'duplicate broadcast', 'то же напоминание без текста повторно: отказ');
select is((bsend('00000000-0000-0000-0000-0000000000ca', 'reminder', 'Срок до пятницы')->>'recipients')::int, 3, 'напоминание с другим текстом проходит');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'reminder', 'Срок до пятницы')$$, '22023', 'duplicate broadcast', 'то же напоминание с текстом повторно: отказ');
select is((bsend('00000000-0000-0000-0000-0000000000ca', 'info', 'Срок до пятницы')->>'recipients')::int > 0, true, 'другой вид с тем же текстом не блокируется');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'info', 'Срок до пятницы')$$, '22023', 'duplicate broadcast', 'информационная повторно: отказ как раньше');

-- ===== 73. C-04: устаревшая карточка =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_cancel((select id from ids where k = 'anya'));
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_update_participant((select id from ids where k = 'anya'), null, 1000, null, null, 'registered')$$, '22023', 'cancelled by parent', 'устаревшая карточка не возвращает отменённую родителем запись в «записан»');
select throws_ok($$select camp_update_participant((select id from ids where k = 'anya'), null, 1000, null, null, 'declined')$$, '22023', 'cancelled by parent', 'и не переводит в «отказ»');
select lives_ok($$select camp_update_participant((select id from ids where k = 'anya'), null, 900, 'M', 'Позвонить', 'cancelled')$$, 'правка суммы и комментария отменённой записи со статусом cancelled работает');
select is((select status || '|' || amount from camp_participants where id = (select id from ids where k = 'anya')), 'cancelled|900.00', 'статус остался cancelled, сумма изменена');
select lives_ok($$select camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, 'вернуть отменившего можно записью заново');
select is((select status from camp_participants where id = (select id from ids where k = 'anya')), 'registered', 'после записи заново статус registered');
select lives_ok($$select camp_update_participant((select id from ids where k = 'borya'), null, 1000, null, null, 'declined')$$, 'registered → declined работает');
select lives_ok($$select camp_update_participant((select id from ids where k = 'borya'), null, 1000, null, null, 'registered')$$, 'declined → registered работает');

-- ===== 74. C-05: оплата =====
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 0, 'payment', null, 'cash', null)$$, '22023', 'bad amount', 'нулевая сумма: отказ как раньше');
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 1000.01, 'payment', null, 'cash', null)$$, '22023', 'overpay', 'платёж больше суммы участника: отказ');
select lives_ok($$select camp_pay((select id from ids where k = 'borya'), 400, 'payment', null, 'cash', null)$$, 'частичный платёж проходит');
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 400, 'payment', null, 'cash', null)$$, '22023', 'duplicate payment', 'такой же платёж сразу повторно: отказ');
select lives_ok($$select camp_pay((select id from ids where k = 'borya'), 400, 'payment', null, 'card', null)$$, 'другой способ оплаты не блокируется');
-- права как раньше
select as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$select camp_pay((select id from ids where k = 'borya'), 100, 'payment', null, 'cash', null)$$, 'локальный админ своего сбора вносит платёж');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 101, 'payment', null, 'cash', null)$$, '22023', 'overpay', 'остаток 100, платёж 101: переплата');
select lives_ok($$select camp_pay((select id from ids where k = 'borya'), 100, 'payment', null, 'transfer', null)$$, 'точное доведение до суммы принимается');
select is((select (now() at time zone 'Asia/Tbilisi')::date = min(paid_on) from camp_payments where participant_id = (select id from ids where k = 'borya')), true, 'дата платежа без даты: сегодня по Тбилиси');
-- Вася отказан админом, Аня отменила позже
select camp_update_participant((select id from ids where k = 'vasya'), null, 1000, null, null, 'declined');
select throws_ok($$select camp_pay((select id from ids where k = 'vasya'), 100, 'payment', null, 'cash', null)$$, '22023', 'not registered', 'платёж по отказанной записи: отказ');
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_cancel((select id from ids where k = 'anya'));
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_pay((select id from ids where k = 'anya'), 100, 'payment', null, 'cash', null)$$, '22023', 'not registered', 'платёж по отменённой родителем записи: отказ');
select as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 1, 'payment', null, 'cash', null)$$, '42501', 'forbidden', 'локальный админ чужой площадки не вносит');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_pay((select id from ids where k = 'borya'), 1, 'payment', null, 'cash', null)$$, '42501', 'forbidden', 'родитель платёж не вносит');

select * from finish();
rollback;
