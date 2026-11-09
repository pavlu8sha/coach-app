-- pgTAP: самозапись на сборы, этап 2 (0161, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 22-27):
-- гостевые заявки: подача, чтение, модерация администратором, доступ гостя после подтверждения.
begin;
create extension if not exists pgtap;
select plan(83);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9802, 'Заявитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9803, 'Заявитель 2', false),
  ('00000000-0000-0000-0000-0000000000c1', 9804, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 9805, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000b3', 9806, 'Заявитель 3', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into camps (id, club_id, name, location, starts_on, ends_on, active) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10', true),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Другой сбор', 'Исани', '2099-02-03', '2099-02-10', true),
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000c001', 'Старый сбор', 'Исани', '2020-01-03', '2020-01-10', true),
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-00000000c001', 'Неактивный сбор', 'Исани', '2099-03-03', '2099-03-10', false),
  ('00000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-00000000c001', 'Сбор для замечаний проверки', 'Исани', '2099-04-03', '2099-04-10', true),
  ('00000000-0000-0000-0000-0000000000cf', '00000000-0000-0000-0000-00000000c001', 'Четвёртый сбор', 'Исани', '2099-05-03', '2099-05-10', true);
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000ca', 'Снятый', 500, false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000cb', 'Тариф другого сбора', 900, true),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000cc', 'Старый', 500, true),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000cd', 'Неактивного', 500, true),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000ca', 'Временный', 700, true),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000ce', 'Тариф замечаний', 800, true),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000cf', 'Тариф четвёртого', 800, true);

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
grant execute on function as_service() to public;
create or replace function as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
grant execute on function as_user(uuid), as_anon() to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;
create temp table cnt (k text primary key, n int);
grant all on cnt to authenticated;
insert into cnt select 'players', count(*) from players;

-- ===== Подача заявки =====
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'a1', camp_apply('00000000-0000-0000-0000-0000000000ca', '  Иван Гость ', '2016-05-04', ' Мама Гостя ', '+995 555 11 22 33', '00000000-0000-0000-0000-0000000000e1', ' хочу ');
select is((select child_name || '|' || child_birth || '|' || parent_name || '|' || parent_phone || '|' || status || '|' || coalesce(comment, '') || '|' || owner_user_id from camp_applications where id = (select id from ids where k = 'a1')),
  'Иван Гость|2016-05-04|Мама Гостя|+995 555 11 22 33|new|хочу|00000000-0000-0000-0000-0000000000b1', 'заявка сохранена: поля без пробелов по краям, статус «Новая», владелец — вызвавший');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Без комментария', '2015-01-01', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, 'комментарий необязателен');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', '  ', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'имя ребёнка обязательно');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', null, 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'дата рождения обязательна');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2999-01-01', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'дата рождения в будущем отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '1900-01-01', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'неправдоподобная дата рождения отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', ' ', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'имя родителя обязательно');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', '', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'телефон обязателен');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', 'позвоните мне', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'bad application', 'телефон из букв отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', null, null)$$, 'P0002', 'tariff not found', 'тариф обязателен');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e3', null)$$, 'P0002', 'tariff not found', 'тариф другого сбора отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e2', null)$$, 'P0002', 'tariff not found', 'снятый с продажи тариф отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000cc', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e4', null)$$, '22023', 'camp closed', 'на закончившийся сбор заявку подать нельзя');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000cd', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e5', null)$$, '22023', 'camp closed', 'на неактивный сбор заявку подать нельзя');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000cb', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, 'P0002', 'tariff not found', 'тариф должен принадлежать тому сбору, на который подана заявка');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', ' иван  ГОСТЬ', '2016-05-04', 'Другая мама', '555 99 99 99', '00000000-0000-0000-0000-0000000000e1', null)$$, '23505', 'already applied', 'повторная заявка на того же ребёнка (без учёта регистра и лишних пробелов) отклоняется');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Третий ребёнок', '2014-02-02', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, 'третья новая заявка пользователя на сбор принимается');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Четвёртый ребёнок', '2013-03-03', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'too many applications', 'больше трёх новых заявок одного пользователя на сбор нельзя');

-- заявки не занимают место и не попадают в участников, платежи, кассу
select as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'u2a', camp_apply('00000000-0000-0000-0000-0000000000ca', 'Чужой ребёнок', '2012-12-12', 'Другая мама', '+995 599 00 00 00', '00000000-0000-0000-0000-0000000000e6', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_set_public('00000000-0000-0000-0000-0000000000cb', null, 1);
insert into ids select 'busy', camp_register_guest('00000000-0000-0000-0000-0000000000cb', 'Занявший место', null, '00000000-0000-0000-0000-0000000000e3', null, null, null);
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000cb', 'Ребёнок при полном сборе', '2012-12-12', 'Другая мама', '+995 599 00 00 00', '00000000-0000-0000-0000-0000000000e3', null)$$, 'при полном сборе заявка принимается (место не резервируется)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000ca'), 0, 'заявки не стали участниками');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000cb'), 1, 'в полном сборе по-прежнему один участник');
select is((cash_report(current_date, current_date)->>'total')::numeric, 0::numeric, 'в кассе заявок нет');

-- ===== Чтение заявок =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_applications), 3, 'заявитель 1 видит только свои три заявки');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from camp_applications), 2, 'заявитель 2 видит только свои две заявки');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from camp_applications), 0, 'тренер заявок не видит');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from camp_applications), 0, 'локальный администратор заявок не видит');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camp_applications), 5, 'администратор видит все заявки');
select as_anon();
select throws_ok($$select * from camp_applications$$, '42501', null, 'аноним заявки не читает');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Ребёнок', '2016-05-04', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, '42501', null, 'аноним заявку подать не может');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into camp_applications (camp_id, owner_user_id, child_name, child_birth, parent_name, parent_phone, tariff_id, status) values ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000b1', 'Прямая', '2016-01-01', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', 'approved')$$, '42501', null, 'прямая вставка заявки запрещена');
select throws_ok($$update camp_applications set status = 'approved'$$, '42501', null, 'заявитель сам статус не меняет');
select throws_ok($$delete from camp_applications$$, '42501', null, 'заявки не удаляются прямым запросом');

-- ===== Модерация =====
select throws_ok($$select camp_application_decide((select id from ids where k = 'a1'), true, null)$$, '42501', 'forbidden', 'заявитель не подтверждает заявки');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_application_decide((select id from ids where k = 'a1'), true, null)$$, '42501', 'forbidden', 'локальный администратор не подтверждает заявки');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'p1', camp_application_decide((select id from ids where k = 'a1'), true, null);
select is((select guest_name || '|' || coalesce(player_id::text, 'нет') || '|' || tariff_id || '|' || amount || '|' || status || '|' || owner_user_id || '|' || guest_contact from camp_participants where id = (select id from ids where k = 'p1')),
  'Иван Гость|нет|00000000-0000-0000-0000-0000000000e1|1000.00|registered|00000000-0000-0000-0000-0000000000b1|Мама Гостя, +995 555 11 22 33', 'подтверждение создало гостевого участника: тариф, сумма, владелец, контакт');
select is((select status || '|' || participant_id || '|' || decided_by from camp_applications where id = (select id from ids where k = 'a1')),
  'approved|' || (select id from ids where k = 'p1') || '|00000000-0000-0000-0000-0000000000a1', 'заявка подтверждена: участник, кто решил');
select throws_ok($$select camp_application_decide((select id from ids where k = 'a1'), false, null)$$, '22023', 'already decided', 'повторное решение отклоняется');
select is((select count(*)::int from players), (select n from cnt where k = 'players'), 'игрок клуба не создаётся');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'p1') and to_status = 'registered'), 1, 'подтверждение попало в журнал статусов');
-- сбор ca без лимита; полный сбор cb проверяется отдельной заявкой
select throws_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Ребёнок при полном сборе'), true, null)$$, '22023', 'camp full', 'при полном сборе подтверждение отклоняется, пока нет места');
select is((select status from camp_applications where child_name = 'Ребёнок при полном сборе'), 'new', 'отклонённое по месту подтверждение оставляет заявку новой');
select camp_update_participant((select id from ids where k = 'busy'), null, 900, null, null, 'declined');
select lives_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Ребёнок при полном сборе'), true, null)$$, 'после освобождения места подтверждение проходит');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000cb' and status = 'registered'), 1, 'лимит 1 не превышен');

select lives_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Без комментария'), false, 'Нет мест в группе')$$, 'отказ по заявке');
select is((select status || '|' || decision_note from camp_applications where child_name = 'Без комментария'), 'rejected|Нет мест в группе', 'отказ сохранён с причиной');
select is((select count(*)::int from camp_participants where guest_name = 'Без комментария'), 0, 'отказ участника не создаёт');
select throws_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Без комментария'), true, null)$$, '22023', 'already decided', 'отказанную заявку подтвердить нельзя');
select throws_ok($$select camp_application_decide((select id from camp_applications where child_name = 'Третий ребёнок'), false, repeat('я', 501))$$, '22023', 'bad note', 'слишком длинная причина отказа отклоняется');
-- тариф снят после подачи
select camp_tariff_save('00000000-0000-0000-0000-0000000000ca', 'Временный', 700, false);
select throws_ok($$select camp_application_decide((select id from ids where k = 'u2a'), true, null)$$, 'P0002', 'tariff not found', 'тариф снят после подачи: подтверждение отклоняется, заявка остаётся новой');
select is((select status from camp_applications where id = (select id from ids where k = 'u2a')), 'new', 'заявка осталась новой');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Без комментария', '2015-01-01', 'Мама', '555 11 22 33', '00000000-0000-0000-0000-0000000000e1', null)$$, 'после отказа ту же заявку можно подать снова');

-- ===== Доступ гостя после подтверждения =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_pay((select id from ids where k = 'p1'), 300, 'payment', current_date, 'Наличные', null);
select camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":"2098-12-01","text":"Полный возврат"}]'::jsonb);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_participants), 1, 'гость видит свою запись участника');
select is((select coalesce(sum(amount), 0) from camp_payments), 300::numeric, 'гость видит платежи по своей записи');
select is((select count(*)::int from camp_participant_events), 1, 'гость видит журнал своей записи');
select is((select count(*)::int from camps where id = '00000000-0000-0000-0000-0000000000ca'), 1, 'гость видит сбор своей записи');
select is((select count(*)::int from camp_cancel_terms where camp_id = '00000000-0000-0000-0000-0000000000ca'), 1, 'гость видит условия отмены сбора');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from camp_participants), 1, 'заявитель 2 видит только свою запись (сбор cb), чужого гостя не видит');
select is((select coalesce(sum(amount), 0) from camp_payments), 0::numeric, 'чужих платежей заявитель 2 не видит');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from camp_participants) + (select count(*)::int from camp_payments), 0, 'тренер гостей и их платежей не видит');


-- ===== Замечания независимой проверки (чужая запись по имени, тёзки, повторная заявка, юникод, владелец, суточный лимит) =====
\set ce '\'00000000-0000-0000-0000-0000000000ce\''
\set e7 '\'00000000-0000-0000-0000-0000000000e7\''
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_apply(:ce, 'Иван Петров', '2015-01-01', 'Мама А', '555 11 11 11', :e7, null);
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x1', camp_application_decide((select id from camp_applications where camp_id = :ce and child_name = 'Иван Петров'), true, null);
select camp_pay((select id from ids where k = 'x1'), 300, 'payment', current_date, 'Наличные', null);
select camp_update_participant((select id from ids where k = 'x1'), null, 800, null, null, 'declined');
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_apply(:ce, 'иван петров', '2016-06-06', 'Мама Б', '555 22 22 22', :e7, null);
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x2', camp_application_decide((select id from camp_applications where camp_id = :ce and child_birth = '2016-06-06'), true, null);
select isnt((select id from ids where k = 'x2'), (select id from ids where k = 'x1'), 'тёзка с другой датой рождения получает новую запись, чужая отказанная запись не забирается');
select is((select guest_name from camp_participants where id = (select id from ids where k = 'x2')), 'иван петров (06.06.2016)', 'имя тёзки получает дату рождения');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = 'x1')), 0::numeric, 'новый гость не видит платежей прежней записи с тем же именем');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'x1')), 0, 'новый гость не видит журнал прежней записи с тем же именем');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = 'x1')), 300::numeric, 'прежний владелец по-прежнему видит свои платежи');
select is((select count(*)::int from camp_participants where camp_id = :ce), 1, 'прежний владелец видит только свою запись');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ce', 'Иван Петров', null, '00000000-0000-0000-0000-0000000000e7', null, null, null)$$, '23505', 'guest has owner', 'админ не поднимает чужую запись с владельцем через ручную запись гостя');
-- тёзки
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_apply(:ce, 'Анна Ли', '2015-01-01', 'Мама А', '555 11 11 11', :e7, null);
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_apply(:ce, 'Анна Ли', '2017-02-02', 'Мама Б', '555 22 22 22', :e7, null);
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'y1', camp_application_decide((select id from camp_applications where camp_id = :ce and child_name = 'Анна Ли' and child_birth = '2015-01-01'), true, null);
select lives_ok($$select camp_application_decide((select id from camp_applications where camp_id = '00000000-0000-0000-0000-0000000000ce' and child_name = 'Анна Ли' and child_birth = '2017-02-02'), true, null)$$, 'подтверждение тёзки с другой датой рождения проходит');
select is((select count(*)::int from camp_participants where camp_id = :ce and status = 'registered' and guest_name like 'Анна Ли%'), 2, 'оба тёзки стали участниками');
-- повторная заявка после отказа участника
select camp_update_participant((select id from ids where k = 'y1'), null, 800, null, null, 'declined');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', 'Анна Ли', '2015-01-01', 'Мама А', '555 11 11 11', '00000000-0000-0000-0000-0000000000e7', null)$$, 'после отказа участника повторная заявка принимается');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'y3', camp_application_decide((select id from camp_applications where camp_id = :ce and child_name = 'Анна Ли' and status = 'new'), true, null);
select isnt((select id from ids where k = 'y3'), (select id from ids where k = 'y1'), 'повторное подтверждение создаёт новую запись');
select is((select status from camp_participants where id = (select id from ids where k = 'y1')), 'declined', 'прежняя запись остаётся отказанной');
-- юникод и пустышки
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_apply(:ce, 'Мария Иванова', '2015-03-03', 'Мама А', '555 11 11 11', :e7, null);
select camp_apply(:ce, 'Юрий Ли', '2015-04-04', 'Мама А', '555 11 11 11', :e7, null);
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', U&'Мария\00A0Иванова', '2015-03-03', 'Мама Б', '555 22 22 22', '00000000-0000-0000-0000-0000000000e7', null)$$, '23505', 'already applied', 'дубль с неразрывным пробелом отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', 'Мария' || chr(8203) || ' Иванова', '2015-03-03', 'Мама Б', '555 22 22 22', '00000000-0000-0000-0000-0000000000e7', null)$$, '23505', 'already applied', 'дубль с невидимым символом отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', normalize('Юрий Ли', NFD), '2015-04-04', 'Мама Б', '555 22 22 22', '00000000-0000-0000-0000-0000000000e7', null)$$, '23505', 'already applied', 'дубль в другой форме юникода отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', repeat(chr(8203), 3), '2015-05-05', 'Мама Б', '555 22 22 22', '00000000-0000-0000-0000-0000000000e7', null)$$, '22023', 'bad application', 'имя ребёнка из невидимых символов отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', 'Пустышка', '2015-05-05', repeat(chr(8203), 3), '555 22 22 22', '00000000-0000-0000-0000-0000000000e7', null)$$, '22023', 'bad application', 'имя родителя из невидимых символов отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', 'Пустышка', '2015-05-05', 'Мама Б', '-----', '00000000-0000-0000-0000-0000000000e7', null)$$, '22023', 'bad application', 'телефон без цифр отклоняется');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000ce', 'Пустышка', '2015-05-05', 'Мама Б', '+-1 2', '00000000-0000-0000-0000-0000000000e7', null)$$, '22023', 'bad application', 'телефон менее 5 цифр отклоняется');
-- владелец записи неизменяем (прямые правки доступны только service_role, администратору закрыты в 0165)
select as_service();
select throws_ok($$update camp_participants set owner_user_id = '00000000-0000-0000-0000-0000000000b2' where id = (select id from ids where k = 'x1')$$, 'P0001', 'immutable', 'владельца гостевой записи нельзя сменить');
select throws_ok($$update camp_participants set owner_user_id = null where id = (select id from ids where k = 'x1')$$, 'P0001', 'immutable', 'владельца гостевой записи нельзя сбросить');
-- суточный лимит заявок одного пользователя
select as_user('00000000-0000-0000-0000-0000000000b3');
select camp_apply(c, 'Лимит ' || n, '2015-01-01', 'Мама В', '555 33 33 33', t, null)
  from (values ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-0000000000e1'::uuid), ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000e3'),
               ('00000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-0000000000e7'), ('00000000-0000-0000-0000-0000000000cf', '00000000-0000-0000-0000-0000000000e8')) camps(c, t),
       generate_series(1, 3) n
  where not (c = '00000000-0000-0000-0000-0000000000cf' and n > 1);
select is((select count(*)::int from camp_applications where owner_user_id = '00000000-0000-0000-0000-0000000000b3'), 10, 'до суточного лимита принято 10 заявок');
select throws_ok($$select camp_apply('00000000-0000-0000-0000-0000000000cf', 'Лимит 99', '2015-01-01', 'Мама В', '555 33 33 33', '00000000-0000-0000-0000-0000000000e8', null)$$, '22023', 'too many applications', 'одиннадцатая заявка за сутки отклоняется');

-- ===== Права на таблицу =====
select ok(not has_table_privilege('authenticated', 'camp_applications', 'insert') and not has_table_privilege('authenticated', 'camp_applications', 'update') and not has_table_privilege('authenticated', 'camp_applications', 'delete')
  and not has_table_privilege('anon', 'camp_applications', 'select') and not has_table_privilege('service_role', 'camp_applications', 'insert'), 'заявки только на чтение вошедшим; запись только через функции');

select * from finish();
rollback;
