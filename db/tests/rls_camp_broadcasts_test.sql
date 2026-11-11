-- pgTAP: самозапись на сборы, этап 6 (0170, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 39-42):
-- две ручные рассылки (информационная и напоминание об оплате), предпросмотр, подтверждение числом получателей, журнал.
begin;
create extension if not exists pgtap;
select plan(57);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9951, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 9952, 'Второй админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9953, 'Родитель двоих (долг)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9954, 'Родитель оплатившего', false),
  ('00000000-0000-0000-0000-0000000000b3', 9955, 'Родитель неучастника', false),
  ('00000000-0000-0000-0000-0000000000b4', 9956, 'Гость подтверждённый (долг)', false),
  ('00000000-0000-0000-0000-0000000000b5', 9957, 'Родитель с выключенными уведомлениями', false),
  ('00000000-0000-0000-0000-0000000000b6', 9958, 'Родитель с отозванным согласием', false),
  ('00000000-0000-0000-0000-0000000000b7', 9959, 'Второй родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b8', 9960, 'Родитель отменившего', false),
  ('00000000-0000-0000-0000-0000000000b9', 9961, 'Родитель из чужого клуба', false),
  ('00000000-0000-0000-0000-0000000000ba', 9962, 'Родитель неактивного игрока', false),
  ('00000000-0000-0000-0000-0000000000c1', 9963, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 9964, 'Локальный админ', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b5';
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'Гена', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', 'Дима', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', 'Егор', 'active'),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-00000000c001', 'Женя', 'active'),
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-00000000c002', 'Зоя', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', 'Игорь', 'inactive');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b7', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now()),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b5', 'test', now()),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000b6', 'test', now()),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000b8', 'test', now()),
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-0000000000b9', 'test', now()),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-0000000000ba', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on, full_payment_deadline) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10', '2098-12-20'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Сбор без срока', 'Исани', '2099-02-03', '2099-02-10', null);
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000cb', 'Другой', 500, true);
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', '');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
grant execute on function as_user(uuid), as_service() to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;
create or replace function nq(u uuid, k text) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = k and user_id = u
$$;
create or replace function ntext(u uuid, k text) returns text language sql security definer as $$
  select string_agg(text, E'\n---\n' order by created_at, id) from notifications where kind = k and user_id = u
$$;
create or replace function nall(k text) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = k
$$;
grant execute on function nq(uuid, text), ntext(uuid, text), nall(text) to public;

-- Участники сбора: Аня и Боря (родитель b1; у Ани есть второй родитель b7), Вася оплачен полностью (b2), Дима (b5, уведомления выключены),
-- Егор (b6, согласие отозвано), Женя отменён (b8), гость подтверждён (b4). Частичная оплата: Аня 400 из 1000.
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'vasya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b5');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b6');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b8');
select camp_parent_cancel(camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000e1', null));
select as_user('00000000-0000-0000-0000-0000000000b4');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Петров', '2015-01-01', 'Папа', '555 11 11 11', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Петров'), true, null);
select camp_pay((select id from ids where k = 'anya'), 400, 'payment', current_date, 'cash', null);
select camp_pay((select id from ids where k = 'vasya'), 1000, 'payment', current_date, 'cash', null);
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b6';
delete from notifications;

-- ===== 39. Кто может: только администратор =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст')$$, '42501', 'forbidden', 'родитель предпросмотр не открывает');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст', 1)$$, '42501', 'forbidden', 'родитель рассылку не отправляет');
select throws_ok($$select * from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'родитель журнал рассылок не читает');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст', 1)$$, '42501', 'forbidden', 'локальный администратор рассылку не отправляет');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст')$$, '42501', 'forbidden', 'тренер предпросмотр не открывает');
select as_service();
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст', 1)$$, '42501', null, 'сервер рассылку не отправляет (расписаний нет)');

-- ===== Проверка входных данных =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'promo', 'Текст')$$, '22023', 'bad kind', 'неизвестный вид рассылки');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', '   ')$$, '22023', 'bad text', 'информационная рассылка без текста отклоняется');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', repeat('я', 1001))$$, '22023', 'bad text', 'слишком длинный текст отклоняется');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-000000000000', 'info', 'Текст')$$, 'P0002', 'camp not found', 'несуществующий сбор');

-- ===== 39-40. Информационная: предпросмотр ничего не отправляет, число получателей то же, что при отправке =====
insert into ids select 'pv', null where false;
select is((camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', ' Выезд в 9:00 от стадиона. ')->>'recipients')::int, 5, 'информационная: пять получателей (родители активных игроков клуба с согласием и включёнными уведомлениями)');
select ok(camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', 'Выезд в 9:00 от стадиона.')->>'sample' like '%Зимний сбор%Выезд в 9:00 от стадиона.%', 'предпросмотр показывает итоговый текст с названием сбора');
select is(nall('camp_broadcast_info'), 0, 'предпросмотр сообщения не ставит');
select is((select count(*)::int from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca')), 0, 'предпросмотр в журнал не пишет');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Выезд в 9:00 от стадиона.', null)$$, '22023', 'confirmation required', 'без подтверждённого числа получателей отправки нет');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Выезд в 9:00 от стадиона.', 4)$$, '22023', 'recipients changed', 'если число получателей не совпало с показанным, отправки нет');
select is(nall('camp_broadcast_info'), 0, 'после отказов сообщений нет');
insert into ids select 'b1', (camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Выезд в 9:00 от стадиона.', 5)->>'id')::uuid;
select is(nall('camp_broadcast_info'), 5, 'отправка ставит ровно столько сообщений, сколько показал предпросмотр');
select is(nq('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_info'), 1, 'родитель двоих детей получает одно сообщение');
select is(nq('00000000-0000-0000-0000-0000000000b7', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000b2', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000b3', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000b8', 'camp_broadcast_info'), 4, 'родители клуба получают сообщение, в том числе не записанные на сбор');
select is(nq('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_info'), 0, 'гость информационную рассылку не получает');
select is(nq('00000000-0000-0000-0000-0000000000b5', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000b6', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000b9', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000ba', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000c1', 'camp_broadcast_info') + nq('00000000-0000-0000-0000-0000000000d1', 'camp_broadcast_info'), 0, 'выключенные уведомления, отозванное согласие, чужой клуб, неактивный игрок, тренер и локальный админ не получают');
select is(nq('00000000-0000-0000-0000-0000000000a1', 'camp_broadcast_info'), 0, 'администратор без детей сообщение не получает');
select is(ntext('00000000-0000-0000-0000-0000000000b3', 'camp_broadcast_info'), ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_info'), 'текст информационной рассылки одинаков для всех');

-- ===== 41. Журнал =====
select is((select kind || '|' || recipients || '|' || pending || '|' || sent || '|' || failed || '|' || (body = 'Выезд в 9:00 от стадиона.') || '|' || author_name from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca')), 'info|5|5|0|0|true|Админ', 'в журнале вид, текст, число получателей, автор и состояние отправки');
reset role;
update notifications set state = 'sent', sent_at = now() where kind = 'camp_broadcast_info' and user_id <> '00000000-0000-0000-0000-0000000000b3';
update notifications set state = 'failed', last_error = 'blocked' where kind = 'camp_broadcast_info' and user_id = '00000000-0000-0000-0000-0000000000b3';
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((select pending || '|' || sent || '|' || failed from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca')), '0|4|1', 'журнал показывает итог отправки, его видит и другой администратор');
select throws_ok($$select count(*) from camp_broadcasts$$, '42501', null, 'прямого чтения журнала нет');
select throws_ok($$delete from camp_broadcasts$$, '42501', null, 'администратор журнал напрямую не удаляет');
reset role;
select throws_ok($$delete from camp_broadcasts$$, 'P0001', 'immutable', 'журнал рассылок не удаляется');
select throws_ok($$update camp_broadcasts set body = 'x'$$, 'P0001', 'immutable', 'журнал рассылок не правится');
select throws_ok($$truncate camp_broadcasts cascade$$, 'P0001', 'immutable', 'журнал рассылок не очищается');

-- ===== Защита от повтора =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Выезд в 9:00 от стадиона.', 5)$$, '22023', 'duplicate broadcast', 'тот же текст повторно в течение десяти минут не отправляется');
select is(nall('camp_broadcast_info'), 5, 'повтор сообщений не добавил');

-- ===== 40. Напоминание об оплате: только семьи с положительным остатком =====
select is((camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'reminder', null)->>'recipients')::int, 3, 'напоминание: три получателя (родитель двоих, второй родитель Ани, гость)');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'reminder', null, 4)$$, '22023', 'recipients changed', 'напоминание с неверным числом получателей не уходит');
select is(nall('camp_broadcast_reminder'), 0, 'предпросмотр напоминания сообщений не ставит');
select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'reminder', 'Просим оплатить до срока.', 3);
select is(nall('camp_broadcast_reminder'), 3, 'напоминание ушло трём получателям');
select is(nq('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder'), 1, 'родитель двоих должников получает одно сообщение');
select ok(ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder') like '%Зимний сбор%' and ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder') like '%Аня: 600.00 ₾%' and ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder') like '%Боря: 1000.00 ₾%', 'в сообщении сбор, имена детей и остаток (частичная оплата учтена)');
select ok(ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder') like '%20.12.2098%' and ntext('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_reminder') like '%Просим оплатить до срока.%', 'в сообщении срок полной оплаты и текст администратора');
select ok(ntext('00000000-0000-0000-0000-0000000000b7', 'camp_broadcast_reminder') like '%Аня: 600.00 ₾%' and ntext('00000000-0000-0000-0000-0000000000b7', 'camp_broadcast_reminder') not like '%Боря%', 'второй родитель Ани видит только Аню');
select ok(ntext('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_reminder') like '%Гость Петров: 1000.00 ₾%' and ntext('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_reminder') not like '%Аня%' and ntext('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_reminder') not like '%Боря%', 'владелец гостевой записи видит только свою запись');
select is(nq('00000000-0000-0000-0000-0000000000b2', 'camp_broadcast_reminder'), 0, 'оплативший полностью напоминание не получает');
select is(nq('00000000-0000-0000-0000-0000000000b8', 'camp_broadcast_reminder') + nq('00000000-0000-0000-0000-0000000000b3', 'camp_broadcast_reminder'), 0, 'отменивший и неучастник напоминание не получают');
select is(nq('00000000-0000-0000-0000-0000000000b5', 'camp_broadcast_reminder') + nq('00000000-0000-0000-0000-0000000000b6', 'camp_broadcast_reminder'), 0, 'выключенные уведомления и отозванное согласие: напоминания нет, хотя долг есть');
select is((select count(*)::int from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca')), 2, 'в журнале две рассылки');
select is((select kind || '|' || recipients from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca') order by created_at desc, kind desc limit 1), 'reminder|3', 'напоминание записано в журнал');

-- после оплаты семья из напоминания уходит
select camp_pay((select id from camp_participants where owner_user_id = '00000000-0000-0000-0000-0000000000b4'), 1000, 'payment', current_date, 'cash', null);
select is((camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'reminder', 'Ещё раз')->>'recipients')::int, 2, 'после полной оплаты получателей на одного меньше');
-- должников нет: отправлять нечего
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000cb', 'reminder', null, 0)$$, '22023', 'no recipients', 'рассылка без получателей не создаётся');
-- сбор без срока оплаты: строки о сроке нет
select camp_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000e2', null, null, null);
select ok(camp_broadcast_preview('00000000-0000-0000-0000-0000000000cb', 'reminder', null)->>'sample' like '%Гена: 500.00 ₾%' and camp_broadcast_preview('00000000-0000-0000-0000-0000000000cb', 'reminder', null)->>'sample' not like '%Срок%', 'без срока оплаты строка о сроке не добавляется');

-- ===== Выключатель camps.notify =====
reset role;
update club_settings set value = 'off' where key = 'camps.notify';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', 'Новый текст')->>'enabled')::boolean, false, 'предпросмотр сообщает, что уведомления по сборам выключены');
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Новый текст', 5)$$, '22023', 'notifications off', 'при выключенном camps.notify рассылка не отправляется');
select is(nall('camp_broadcast_info'), 5, 'сообщений не прибавилось');
reset role;
update club_settings set value = 'on' where key = 'camps.notify';

-- ===== Лимит: не больше пяти рассылок по сбору за сутки =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст 3', 5);
select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст 4', 5);
select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст 5', 5);
select throws_ok($$select camp_broadcast_send('00000000-0000-0000-0000-0000000000ca', 'info', 'Текст 6', 5)$$, '22023', 'too many broadcasts', 'шестая рассылка по сбору за сутки отклоняется');
-- ссылки и упоминания в тексте администратора остаются как есть, управляющие символы убираются
select ok(camp_broadcast_preview('00000000-0000-0000-0000-0000000000cb', 'info', E'Строка 1\nСтрока 2​')->>'sample' like E'%Строка 1\nСтрока 2', 'переносы строк сохраняются, невидимые символы убираются');
-- 42. расписаний нет: функции отправки не выданы серверу и анониму
reset role;
select ok(not has_function_privilege('service_role', 'camp_broadcast_send(uuid, text, text, int)', 'execute') and not has_function_privilege('anon', 'camp_broadcast_send(uuid, text, text, int)', 'execute'), 'отправка рассылки не выдана серверу и анониму');
select is((select count(*)::int from pg_trigger where not tgisinternal and tgfoid in (select oid from pg_proc where proname like 'camp_broadcast%' and proname <> 'camp_broadcasts_guard')), 0, 'ни один триггер рассылку не запускает');

select * from finish();
rollback;
