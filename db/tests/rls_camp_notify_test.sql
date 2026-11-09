-- pgTAP: самозапись на сборы, этап 4 (0167, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 34-36):
-- уведомления о записи, гостевой заявке, решении по заявке и отмене; выключатель camps.notify по умолчанию выключен.
begin;
create extension if not exists pgtap;
select plan(38);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into users (id, telegram_id, display_name, is_admin, notifications_enabled) values
  ('00000000-0000-0000-0000-0000000000a1', 9911, 'Админ 1', true, true),
  ('00000000-0000-0000-0000-0000000000a2', 9912, 'Админ 2', true, true),
  ('00000000-0000-0000-0000-0000000000a3', 9913, 'Админ и локальный', true, true),
  ('00000000-0000-0000-0000-0000000000a4', 9914, 'Админ без уведомлений', true, false),
  ('00000000-0000-0000-0000-0000000000d1', 9915, 'Локальный админ', false, true),
  ('00000000-0000-0000-0000-0000000000b1', 9916, 'Мама Ани', false, true),
  ('00000000-0000-0000-0000-0000000000b2', 9917, 'Гость с уведомлениями', false, true),
  ('00000000-0000-0000-0000-0000000000b3', 9918, 'Гость без уведомлений', false, false);
insert into location_admins (user_id, location) values
  ('00000000-0000-0000-0000-0000000000d1', 'Исани'), ('00000000-0000-0000-0000-0000000000a3', 'Исани');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня Иванова', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря Иванов', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Сын Админа', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', 'Для сбоя', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c002', 'Игрок другого клуба', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000a2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c002', 'Сбор другого клуба', 'Исани', '2099-01-03', '2099-01-10');
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000cb', 'Другого клуба', 1000, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
-- очередь читает только владелец базы: счётчики через функцию
create or replace function nq(k text, u uuid default null) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = k and (u is null or user_id = u)
     and user_id in (select id from users where telegram_id between 9911 and 9920)
$$;
create or replace function nhas(k text, u uuid, pat text) returns boolean language sql security definer as $$
  select exists (select 1 from notifications where kind = k and user_id = u and text like pat)
$$;
create or replace function nall(k text, u uuid, pat text) returns boolean language sql security definer as $$
  select not exists (select 1 from notifications where kind = k and user_id = u and text not like pat)
$$;
grant execute on function nq(text, uuid), nhas(text, uuid, text), nall(text, uuid, text) to public;

-- ===== 36. Выключатель: по умолчанию выключен =====
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Тихий Гость', '2015-01-01', 'Мама', '555 00 00 00', '00000000-0000-0000-0000-0000000000e1', null);
select camp_parent_cancel((select id from ids where k = 'anya'));
select is(nq('camp_signup') + nq('camp_application') + nq('camp_cancel') + nq('camp_application_decision'), 0, 'пока camps.notify не включён, в очередь ничего не ставится');
reset role;
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c002', 'camps.notify', 'on', 'other');

-- ===== 34, 35. Новая запись игрока: администраторам, кроме локальных =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_signup'), 2, 'запись родителем: сообщение двум администраторам');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a1') + nq('camp_signup', '00000000-0000-0000-0000-0000000000a2'), 2, 'получатели: администраторы без локальной роли');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000d1') + nq('camp_signup', '00000000-0000-0000-0000-0000000000a3'), 0, 'локальный администратор и администратор с локальной ролью не получают');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a4'), 0, 'администратор с выключенными уведомлениями не получает');
select ok(nhas('camp_signup', '00000000-0000-0000-0000-0000000000a1', '%Зимний сбор%') and nhas('camp_signup', '00000000-0000-0000-0000-0000000000a1', '%Аня Иванова%'), 'в сообщении название сбора и имя ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'borya', camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null, null, null);
select is(nq('camp_signup'), 2, 'запись администратором уведомление администраторам не шлёт');
select camp_update_participant((select id from ids where k = 'borya'), null, 900, null, null, 'registered');
select is(nq('camp_signup') + nq('camp_cancel'), 2, 'правка суммы администратором уведомлений не шлёт');

-- ===== 34. Гостевая заявка и решение =====
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Первый', '2015-02-02', 'Папа Гостя', '555 12 34 56', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_application'), 2, 'новая заявка: сообщение двум администраторам');
select ok(nhas('camp_application', '00000000-0000-0000-0000-0000000000a1', '%Зимний сбор%') and not nhas('camp_application', '00000000-0000-0000-0000-0000000000a1', '%Гость Первый%'), 'в сообщении о заявке сбор, без данных из заявки (их вводит посторонний)');
select ok(not nhas('camp_application', '00000000-0000-0000-0000-0000000000a1', '%555 12 34 56%'), 'телефон в сообщение не попадает');
select as_user('00000000-0000-0000-0000-0000000000b3');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Второй', '2015-03-03', 'Мама Гостя', '555 65 43 21', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Первый'), true, null);
select is(nq('camp_application_decision', '00000000-0000-0000-0000-0000000000b2'), 1, 'подтверждение: сообщение владельцу заявки');
select ok(nhas('camp_application_decision', '00000000-0000-0000-0000-0000000000b2', '%подтверждена%') and nhas('camp_application_decision', '00000000-0000-0000-0000-0000000000b2', '%Гость Первый%') and nhas('camp_application_decision', '00000000-0000-0000-0000-0000000000b2', '%Зимний сбор%'), 'в сообщении решение, ребёнок и сбор');
select is(nq('camp_signup'), 2, 'подтверждение заявки не дублируется сообщением о новой записи');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Второй'), false, 'Нет мест в группе');
select is(nq('camp_application_decision', '00000000-0000-0000-0000-0000000000b3'), 0, 'владелец с выключенными уведомлениями сообщение не получает');
select is(nq('camp_application_decision'), 1, 'решение получает только владелец заявки');
select camp_application_decide((select id from camp_applications where child_name = 'Тихий Гость'), false, 'Нет мест в группе');
select ok(nhas('camp_application_decision', '00000000-0000-0000-0000-0000000000b1', '%отклонена%') and nhas('camp_application_decision', '00000000-0000-0000-0000-0000000000b1', '%Нет мест в группе%'), 'отказ: в сообщении решение и причина');

-- ===== 34. Отмена родителем =====
select camp_pay((select id from camp_participants where player_id = '00000000-0000-0000-0000-00000000d001'), 400, 'payment', current_date, 'Наличные', null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_cancel((select id from ids where k = 'anya'));
select is(nq('camp_cancel'), 2, 'отмена родителем: сообщение двум администраторам');
select ok(nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%Зимний сбор%') and nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%Аня Иванова%') and nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%Мама Ани%'), 'в сообщении сбор, ребёнок и родитель');
select ok(nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%400%') and nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%возврат%'), 'в сообщении внесённая сумма и пометка про возврат');
select ok(nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a2', '%__.__.____ __:__%'), 'в сообщении время отмены');
select is(nq('camp_cancel', '00000000-0000-0000-0000-0000000000d1') + nq('camp_cancel', '00000000-0000-0000-0000-0000000000a3') + nq('camp_cancel', '00000000-0000-0000-0000-0000000000a4'), 0, 'отмена: локальные и выключившие уведомления не получают');
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_parent_cancel((select participant_id from camp_applications where child_name = 'Гость Первый'));
select is(nq('camp_cancel'), 4, 'отмена гостевой записи владельцем тоже уходит администраторам');
select ok(nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a1', '%Гость Первый%'), 'в сообщении имя гостя');
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_update_participant((select id from ids where k = 'borya'), null, 900, null, null, 'declined');
select is(nq('camp_cancel'), 4, 'отказ администратором уведомление об отмене не шлёт');

-- ===== Замечания независимой проверки =====
-- другой клуб: включение у одного клуба и значение с другим scope не включают уведомления
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000e2', null);
select is(nq('camp_signup'), 2, 'сбор другого клуба: настройка своего клуба и чужой scope уведомления не включают');
-- автор действия своё сообщение не получает (администратор, записывающий своего ребёнка как родитель)
select as_user('00000000-0000-0000-0000-0000000000a2');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a1')::text || '/' || nq('camp_signup', '00000000-0000-0000-0000-0000000000a2'), '2/1', 'администратор-родитель сам себе сообщение не получает, второй администратор получает');
-- ссылки и дата рождения из имени гостя в сообщение не попадают
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Оплата https://evil.example/pay @bot', '2015-04-04', 'Папа Гостя', '555 12 34 56', '00000000-0000-0000-0000-0000000000e1', null);
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Первый', '2016-05-05', 'Папа Гостя', '555 12 34 56', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name like 'Оплата%'), true, null);
select camp_application_decide((select id from camp_applications where child_name = 'Гость Первый' and status = 'new'), true, null);
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_parent_cancel((select participant_id from camp_applications where child_name like 'Оплата%'));
select camp_parent_cancel((select participant_id from camp_applications where child_name = 'Гость Первый' and child_birth = '2016-05-05'));
select ok(not nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a1', '%://%') and not nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a1', '%evil.example%') and not nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a1', '%@%'), 'ссылка и упоминание из имени гостя в сообщение не попадают');
select ok(not nhas('camp_cancel', '00000000-0000-0000-0000-0000000000a1', '%05.05.2016%'), 'дата рождения из имени гостя-тёзки в сообщение не попадает');
-- смена тарифа родителем уведомление не шлёт
reset role;
update camps set full_payment_deadline = '2098-12-01' where id = '00000000-0000-0000-0000-0000000000ca';
insert into camp_tariffs (id, camp_id, name, price, active) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000ca', 'Второй', 1100, true);
select as_user('00000000-0000-0000-0000-0000000000a2');
select camp_parent_update((select id from camp_participants where player_id = '00000000-0000-0000-0000-00000000d003'), '00000000-0000-0000-0000-0000000000e3', null);
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a1'), 2, 'смена тарифа родителем уведомление не шлёт');
-- цикл «отмена, запись» не заваливает администраторов: не больше трёх сообщений каждого вида на запись за сутки
select camp_parent_cancel((select id from camp_participants where player_id = '00000000-0000-0000-0000-00000000d003')),
       camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null)
  from generate_series(1, 6);
select ok((select count(*) from camp_participant_events where player_id = '00000000-0000-0000-0000-00000000d003' and to_status = 'cancelled') = 6, 'шесть отмен в журнале есть');
reset role;
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a1')::text || '/' || (select count(*) from notifications where kind = 'camp_cancel' and user_id = '00000000-0000-0000-0000-0000000000a1' and text like '%Сын Админа%'), '4/3', 'повторные отмены и записи одной и той же записи ограничены тремя сообщениями каждого вида в сутки');
-- ===== 36. Выключение обратно и права =====
reset role;
update club_settings set value = 'off' where key = 'camps.notify';
create temp table cnt as select nq('camp_signup') n;
grant select on cnt to authenticated;
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_signup'), (select n from cnt), 'после выключения новые сообщения не ставятся');
select throws_ok($$select camp_notify_enabled('00000000-0000-0000-0000-00000000c001')$$, '42501', null, 'служебные функции уведомлений пользователям не выданы');

-- сбой очереди уведомлений не отменяет запись, отмену и решение
reset role;
update club_settings set value = 'on' where key = 'camps.notify';
create or replace function enqueue_notification(u uuid, k text, t text) returns void language plpgsql as $$ begin raise exception 'queue down'; end $$;
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000e1', null)$$, 'сбой очереди не отменяет запись');
select lives_ok($$select camp_parent_cancel((select id from camp_participants where player_id = '00000000-0000-0000-0000-00000000d005'))$$, 'сбой очереди не отменяет отмену');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Заявка при сбое', '2015-06-06', 'Мама', '555 00 00 00', '00000000-0000-0000-0000-0000000000e1', null)$$, 'сбой очереди не отменяет заявку');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Заявка при сбое'), false, null)$$, 'сбой очереди не отменяет решение по заявке');

select * from finish();
rollback;
