-- pgTAP: самозапись на сборы, этап 4 (0167, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 34-36):
-- уведомления о записи, гостевой заявке, решении по заявке и отмене; выключатель camps.notify по умолчанию выключен.
begin;
create extension if not exists pgtap;
select plan(27);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
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
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря Иванов', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10');
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true);

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
$$;
create or replace function ntext(k text, u uuid) returns text language sql security definer as $$
  select text from notifications where kind = k and user_id = u order by created_at desc, id desc limit 1
$$;
grant execute on function nq(text, uuid), ntext(text, uuid) to public;

-- ===== 36. Выключатель: по умолчанию выключен =====
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Тихий Гость', '2015-01-01', 'Мама', '555 00 00 00', '00000000-0000-0000-0000-0000000000e1', null);
select camp_parent_cancel((select id from ids where k = 'anya'));
select is(nq('camp_signup') + nq('camp_application') + nq('camp_cancel') + nq('camp_application_decision'), 0, 'пока camps.notify не включён, в очередь ничего не ставится');
reset role;
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', '');

-- ===== 34, 35. Новая запись игрока: администраторам, кроме локальных =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_signup'), 2, 'запись родителем: сообщение двум администраторам');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a1') + nq('camp_signup', '00000000-0000-0000-0000-0000000000a2'), 2, 'получатели: администраторы без локальной роли');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000d1') + nq('camp_signup', '00000000-0000-0000-0000-0000000000a3'), 0, 'локальный администратор и администратор с локальной ролью не получают');
select is(nq('camp_signup', '00000000-0000-0000-0000-0000000000a4'), 0, 'администратор с выключенными уведомлениями не получает');
select ok(ntext('camp_signup', '00000000-0000-0000-0000-0000000000a1') like '%Зимний сбор%' and ntext('camp_signup', '00000000-0000-0000-0000-0000000000a1') like '%Аня Иванова%', 'в сообщении название сбора и имя ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'borya', camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null, null, null);
select is(nq('camp_signup'), 2, 'запись администратором уведомление администраторам не шлёт');
select camp_update_participant((select id from ids where k = 'borya'), null, 900, null, null, 'registered');
select is(nq('camp_signup') + nq('camp_cancel'), 2, 'правка суммы администратором уведомлений не шлёт');

-- ===== 34. Гостевая заявка и решение =====
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Первый', '2015-02-02', 'Папа Гостя', '555 12 34 56', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_application'), 2, 'новая заявка: сообщение двум администраторам');
select ok(ntext('camp_application', '00000000-0000-0000-0000-0000000000a1') like '%Зимний сбор%' and ntext('camp_application', '00000000-0000-0000-0000-0000000000a1') like '%Гость Первый%', 'в сообщении о заявке сбор и имя ребёнка');
select ok(ntext('camp_application', '00000000-0000-0000-0000-0000000000a1') not like '%555 12 34 56%', 'телефон в сообщение не попадает');
select as_user('00000000-0000-0000-0000-0000000000b3');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Второй', '2015-03-03', 'Мама Гостя', '555 65 43 21', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Первый'), true, null);
select is(nq('camp_application_decision', '00000000-0000-0000-0000-0000000000b2'), 1, 'подтверждение: сообщение владельцу заявки');
select ok(ntext('camp_application_decision', '00000000-0000-0000-0000-0000000000b2') like '%подтверждена%' and ntext('camp_application_decision', '00000000-0000-0000-0000-0000000000b2') like '%Гость Первый%' and ntext('camp_application_decision', '00000000-0000-0000-0000-0000000000b2') like '%Зимний сбор%', 'в сообщении решение, ребёнок и сбор');
select is(nq('camp_signup'), 2, 'подтверждение заявки не дублируется сообщением о новой записи');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Второй'), false, 'Нет мест в группе');
select is(nq('camp_application_decision', '00000000-0000-0000-0000-0000000000b3'), 0, 'владелец с выключенными уведомлениями сообщение не получает');
select is(nq('camp_application_decision'), 1, 'решение получает только владелец заявки');
select camp_application_decide((select id from camp_applications where child_name = 'Тихий Гость'), false, 'Нет мест в группе');
select ok(ntext('camp_application_decision', '00000000-0000-0000-0000-0000000000b1') like '%отклонена%' and ntext('camp_application_decision', '00000000-0000-0000-0000-0000000000b1') like '%Нет мест в группе%', 'отказ: в сообщении решение и причина');

-- ===== 34. Отмена родителем =====
select camp_pay((select id from camp_participants where player_id = '00000000-0000-0000-0000-00000000d001'), 400, 'payment', current_date, 'Наличные', null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_cancel((select id from ids where k = 'anya'));
select is(nq('camp_cancel'), 2, 'отмена родителем: сообщение двум администраторам');
select ok(ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') like '%Зимний сбор%' and ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') like '%Аня Иванова%' and ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') like '%Мама Ани%', 'в сообщении сбор, ребёнок и родитель');
select ok(ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') like '%400%' and ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') like '%возврат%', 'в сообщении внесённая сумма и пометка про возврат');
select ok(ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a2') ~ '\d\d\.\d\d\.\d\d\d\d \d\d:\d\d', 'в сообщении время отмены');
select is(nq('camp_cancel', '00000000-0000-0000-0000-0000000000d1') + nq('camp_cancel', '00000000-0000-0000-0000-0000000000a3') + nq('camp_cancel', '00000000-0000-0000-0000-0000000000a4'), 0, 'отмена: локальные и выключившие уведомления не получают');
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_parent_cancel((select participant_id from camp_applications where child_name = 'Гость Первый'));
select is(nq('camp_cancel'), 4, 'отмена гостевой записи владельцем тоже уходит администраторам');
select ok(ntext('camp_cancel', '00000000-0000-0000-0000-0000000000a1') like '%Гость Первый%', 'в сообщении имя гостя');
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_update_participant((select id from ids where k = 'borya'), null, 900, null, null, 'declined');
select is(nq('camp_cancel'), 4, 'отказ администратором уведомление об отмене не шлёт');

-- ===== 36. Выключение обратно и права =====
reset role;
update club_settings set value = 'off' where key = 'camps.notify';
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select is(nq('camp_signup'), 2, 'после выключения новые сообщения не ставятся');
select throws_ok($$select camp_notify_enabled('00000000-0000-0000-0000-00000000c001')$$, '42501', null, 'служебные функции уведомлений пользователям не выданы');

select * from finish();
rollback;
