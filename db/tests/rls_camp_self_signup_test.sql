-- pgTAP: самозапись на сборы, этап 1 (0160, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md):
-- вместимость во всех путях записи, родительская запись, публичные данные, условия отмены, журнал статусов.
begin;
create extension if not exists pgtap;
select plan(113);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9703, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000c1', 9704, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'Неактивный', 'inactive'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c002', 'Чужой клуб', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', 'Гена', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000b2', 'test', now());
-- Сборы далеко в будущем, чтобы проверка «сбор закончился» не мешала
insert into camps (id, club_id, name, starts_on, ends_on, full_payment_deadline) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', '2099-01-03', '2099-01-10', '2098-12-20'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Другой сбор', '2099-02-03', '2099-02-10', null),
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000c001', 'Старый сбор', '2020-01-03', '2020-01-10', null);
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1500, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000ca', 'Дешёвый', 100, true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000cb', 'Чужого сбора', 900, true),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000cc', 'Старый', 500, true);

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

-- ===== Настройка сбора администратором: лимит и публичная ссылка =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter', 2)$$, '42501', 'forbidden', 'тренер лимит и ссылку не задаёт');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter', 2)$$, '42501', 'forbidden', 'родитель лимит и ссылку не задаёт');
select throws_ok($$select camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, '42501', 'forbidden', 'родитель не вызывает админскую запись');

select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'Bad Slug!', 2)$$, '22023', 'bad slug', 'ссылка только из латиницы, цифр и дефиса');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'a--', 2)$$, '22023', 'bad slug', 'ссылка без двойных дефисов и дефиса в конце');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter', 0)$$, '22023', 'bad capacity', 'лимит не меньше 1');
select lives_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'Winter-2099', 2)$$, 'админ задаёт ссылку и лимит 2');
select is((select slug from camps where id = '00000000-0000-0000-0000-0000000000ca'), 'winter-2099', 'ссылка хранится в нижнем регистре');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000cb', 'winter-2099', null)$$, '23505', null, 'ссылка уникальна');

-- ===== Вместимость в админских путях =====
insert into ids select 'a', camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null, null, null);
insert into ids select 'g', camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость', null, '00000000-0000-0000-0000-0000000000e1', null, null, null);
select throws_ok($$select camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, '22023', 'camp full', 'админ не превышает лимит записью игрока');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Второй гость', null, '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, '22023', 'camp full', 'админ не превышает лимит записью гостя');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000ca'), 2, 'отказанные записи ничего не создали');
select camp_update_participant((select id from ids where k = 'g'), null, 1500, null, null, 'declined');
select lives_ok($$select camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, 'отказ освободил место');
select throws_ok($$select camp_update_participant((select id from ids where k = 'g'), null, 1500, null, null, 'registered')$$, '22023', 'camp full', 'возврат отказанного в registered тоже проверяет лимит');
select lives_ok($$select camp_update_participant((select id from ids where k = 'a'), null, 1600, null, 'правка', 'registered')$$, 'правка уже записанного не требует места');
select throws_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter-2099', 1)$$, '22023', 'capacity below registered', 'лимит ниже числа подтверждённых участников запрещён (2 записано, лимит 1)');
select lives_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter-2099', 2)$$, 'лимит, равный числу подтверждённых, разрешён (2 и 2)');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Третий', null, '00000000-0000-0000-0000-0000000000e1', null, null, null)$$, '22023', 'camp full', 'после снижения новые записи невозможны');
select lives_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000ca', 'winter-2099', 3)$$, 'лимит поднят до 3');

-- ===== Родительская запись =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null)$$, '42501', 'forbidden', 'чужой ребёнок: forbidden');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'not eligible', 'неактивный ребёнок отклоняется');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'not eligible', 'ребёнок другого клуба отклоняется');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e3', null)$$, 'P0002', 'tariff not found', 'тариф другого сбора отклоняется');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e4', null)$$, '22023', 'camp closed', 'на закончившийся сбор записаться нельзя');
insert into ids select 'b', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', ' хочу ');
select is((select amount || '/' || status || '/' || coalesce(comment, '') from camp_participants where id = (select id from ids where k = 'b')), '1500.00/registered/хочу', 'запись сразу подтверждена, сумма по тарифу');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null)$$, '23505', 'already registered', 'повторная активная запись отклоняется');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000ca' and player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'дубля строки нет');

-- места кончились (A, B, Вася = 3 из 3): родитель 2 получает отказ
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'camp full', 'без мест родитель не записывает ребёнка');
select is(camp_seats('00000000-0000-0000-0000-0000000000ca'), 0, 'свободных мест 0');
select is(camp_seats('00000000-0000-0000-0000-0000000000cb'), null, 'без лимита свободные места не считаются (null)');

-- ===== Доступ родителя к чужим данным =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_participants), 2, 'родитель 1 видит только записи своих детей (Аня, Боря)');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from camp_participants), 1, 'родитель 2 видит только Васю');
select is((select count(*)::int from camp_participants where guest_name is not null), 0, 'гостей родитель не видит');

-- ===== Независимость детей, отмена, повторная запись, журнал =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_pay((select id from ids where k = 'b'), 500, 'booking', current_date, 'Наличные', null);
select camp_update_participant((select id from ids where k = 'b'), null, 1500, null, null, 'declined');
select is((select status from camp_participants where id = (select id from ids where k = 'a')), 'registered', 'отказ одного ребёнка не меняет запись другого');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'registration declined', 'отказ администратора родитель не отменяет повторной записью');
reset role;
update camp_participants set status = 'cancelled' where id = (select id from ids where k = 'b');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e2', null)$$, '22023', 'amount below paid', 'повторная запись по тарифу дешевле оплаченного отклоняется');
select lives_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null)$$, 'после отмены родитель записывает ребёнка снова');
select is((select count(*)::int from camp_participants where player_id = '00000000-0000-0000-0000-00000000d002' and camp_id = '00000000-0000-0000-0000-0000000000ca'), 1, 'используется та же строка участника');
select is((select sum(amount) from camp_payments where participant_id = (select id from ids where k = 'b')), 500::numeric, 'платежи прежней записи сохранены');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'b')), 4, 'журнал статусов родителю виден: запись, отказ админа, отмена, повторная запись');
select throws_ok($$update camp_participant_events set note = 'x'$$, '42501', null, 'родитель журнал не правит (нет прав)');
reset role;
select throws_ok($$update camp_participant_events set note = 'x'$$, 'P0001', null, 'журнал неизменяем даже для владельца базы');
select throws_ok($$delete from camp_participant_events$$, 'P0001', null, 'записи журнала не удаляются');

-- ===== Условия отмены: версии =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":"2098-12-01","text":"Полный возврат"}]'::jsonb)$$, '42501', 'forbidden', 'родитель условия не меняет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":null,"text":" "}]'::jsonb)$$, '22023', 'bad terms', 'пустой текст периода отклоняется');
select is(camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":"2098-12-01","text":"Полный возврат"},{"from":"2098-12-02","to":"2098-12-19","text":"500 GEL не возвращаются"}]'::jsonb), 1, 'первая версия условий');
select is(camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":"2098-12-01","text":"Полный возврат"}]'::jsonb), 2, 'новая версия, прежняя остаётся');
reset role;
select throws_ok($$update camp_cancel_terms set periods = '[]'::jsonb$$, 'P0001', null, 'версия условий неизменяема');

-- ===== Публичные данные без входа =====
select as_anon();
select is((select array_agg(k order by k) from jsonb_object_keys(camp_public('winter-2099')) k), array['camp', 'seats_available', 'tariffs', 'terms'], 'аноним получает только сбор, тарифы, условия и признак мест');
select is(camp_public('winter-2099') -> 'camp' ->> 'name', 'Зимний сбор', 'название сбора доступно без входа');
select is(jsonb_array_length(camp_public('winter-2099') -> 'terms'), 1, 'в публичных данных последняя версия условий');
select is((camp_public('winter-2099') ->> 'seats_available')::boolean, false, 'признак мест: 3 из 3, мест нет');
select is(camp_public('net-takoj'), null, 'неизвестная ссылка: пусто');
select throws_ok($$select * from camp_participants$$, '42501', null, 'аноним строки участников не читает');
select throws_ok($$select * from camps$$, '42501', null, 'аноним таблицу сборов не читает');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null)$$, '42501', null, 'аноним не вызывает родительскую запись');

-- ===== Закрытие находок независимой проверки =====
select as_user('00000000-0000-0000-0000-0000000000a1');
-- повторная запись администратором после отказа не опускает сумму ниже оплаченного
insert into ids select 'h', camp_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e3', null, null, null);
select camp_pay((select id from ids where k = 'h'), 500, 'payment', current_date, 'Наличные', null);
select camp_update_participant((select id from ids where k = 'h'), null, 900, null, null, 'declined');
select throws_ok($$select camp_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e3', 100, null, null)$$, '22023', 'amount below paid', 'camp_register после отказа: сумма ниже оплаченного отклоняется');
insert into ids select 'hg', camp_register_guest('00000000-0000-0000-0000-0000000000cb', 'Гость Х', null, '00000000-0000-0000-0000-0000000000e3', null, null, null);
select camp_pay((select id from ids where k = 'hg'), 500, 'payment', current_date, 'Наличные', null);
select camp_update_participant((select id from ids where k = 'hg'), null, 900, null, null, 'declined');
select throws_ok($$select camp_register_guest('00000000-0000-0000-0000-0000000000cb', 'Гость Х', null, '00000000-0000-0000-0000-0000000000e3', 10, null, null)$$, '22023', 'amount below paid', 'camp_register_guest после отказа: сумма ниже оплаченного отклоняется');

-- прямая запись в таблицу не обходит лимит и журнал (лимит 1)
select camp_set_public('00000000-0000-0000-0000-0000000000cb', 'other-2099', 1);
insert into ids select 'd1', camp_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e3', null, null, null);
-- прямые записи возможны только у service_role (0165 закрыла их вошедшим): ограничения вместимости и журнал действуют и для неё
select as_service();
select throws_ok($$insert into camp_participants (camp_id, player_id, tariff_id, amount, status) values ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000e3', 900, 'registered')$$, '22023', 'camp full', 'прямая вставка в таблицу не превышает лимит');
select throws_ok($$update camp_participants set status = 'registered' where id = (select id from ids where k = 'h')$$, '22023', 'camp full', 'прямой переход declined в registered не превышает лимит');
select lives_ok($$update camp_participants set status = 'cancelled' where id = (select id from ids where k = 'd1')$$, 'прямой перевод в cancelled разрешён администратору');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'd1') and to_status = 'cancelled' and note = 'direct'), 1, 'прямая смена статуса попала в журнал с пометкой direct');
select is((select note from camp_participant_events where participant_id = (select id from ids where k = 'd1') and to_status = 'registered'), 'admin', 'запись через функцию помечена admin');

select as_user('00000000-0000-0000-0000-0000000000a1');
-- администратор правит сумму и комментарий отменённой записи, статус остаётся
select lives_ok($$select camp_update_participant((select id from ids where k = 'd1'), null, 950, null, 'после отмены', 'cancelled')$$, 'правка суммы отменённой записи без смены статуса');
select throws_ok($$select camp_update_participant((select id from ids where k = 'a'), null, 950, null, null, 'cancelled')$$, '22023', 'bad status', 'администратор не выставляет cancelled другим записям');

-- смена сбора прямым update не обходит лимит; запись с журналом не удаляется; статус null и «пустой» текст
select camp_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000e3', null, null, null);
select as_service();
select throws_ok($$update camp_participants set camp_id = '00000000-0000-0000-0000-0000000000cb' where id = (select id from ids where k = 'a')$$, '22023', 'camp full', 'перенос записи на полный сбор прямым update не обходит лимит');
select throws_ok($$delete from camp_participants where id = (select id from ids where k = 'a')$$, '42501', null, 'участник не удаляется прямым запросом (0165)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_update_participant((select id from ids where k = 'a'), null, 950, null, null, null)$$, '22023', 'bad status', 'статус null отклоняется');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000cb', jsonb_build_array(jsonb_build_object('text', E'\u00a0\u200b')))$$, '22023', 'bad terms', 'текст из невидимых символов отклоняется');

-- служебная роль не пишет в журнал и условия напрямую
select ok(not has_table_privilege('service_role', 'camp_participant_events', 'insert') and not has_table_privilege('service_role', 'camp_cancel_terms', 'insert'), 'служебная роль журнал и условия только читает');

-- условия: лишние ключи отбрасываются, форма проверяется
select is(camp_terms_save('00000000-0000-0000-0000-0000000000cb', '[{"from":null,"to":"2099-01-01","text":" Возврат ","secret":"x"}]'::jsonb), 1, 'версия условий сохранена');
select is((select periods::text from camp_cancel_terms where camp_id = '00000000-0000-0000-0000-0000000000cb' and version = 1), '[{"to": "2099-01-01", "from": null, "text": "Возврат"}]', 'лишние ключи отброшены, текст без пробелов по краям');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000cb', '[]'::jsonb)$$, '22023', 'bad terms', 'пустой список периодов отклоняется');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000cb', '[{"from":20981201,"to":null,"text":"x"}]'::jsonb)$$, '22023', 'bad terms', 'дата числом отклоняется');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000cb', '[{"from":"2099-01-05","to":"2099-01-01","text":"x"}]'::jsonb)$$, '22023', 'bad terms', 'конец периода раньше начала отклоняется');
select throws_ok($$select camp_terms_save('00000000-0000-0000-0000-0000000000cb', (select jsonb_agg(jsonb_build_object('text', 'x', 'pad', repeat('я', 1000))) from generate_series(1, 10)))$$, '22023', 'bad terms', 'слишком большой объём условий отклоняется');

-- ссылку и лимит можно менять раздельно
select camp_set_public('00000000-0000-0000-0000-0000000000cb', null, 4);
select is((select slug || '/' || capacity from camps where id = '00000000-0000-0000-0000-0000000000cb'), 'other-2099/4', 'sl = null оставляет ссылку, меняет лимит');
select camp_set_public('00000000-0000-0000-0000-0000000000cb', '', 4);
select is((select slug from camps where id = '00000000-0000-0000-0000-0000000000cb'), null, 'пустая строка убирает ссылку');

-- публичные данные: закончившийся сбор не отдаётся
select camp_set_public('00000000-0000-0000-0000-0000000000cc', 'old-2020', null);
select as_anon();
select is(camp_public('old-2020'), null, 'закончившийся сбор аноним не видит');


-- ===== Замечания Павла к PR #586: лимит не ниже подтверждённых; доступ к camp_seats и условиям отмены =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000cb', 'other-2099', 1)$$, 'лимит 1 при одном подтверждённом: отменённые и отказанные не считаются');
select lives_ok($$select camp_set_public('00000000-0000-0000-0000-0000000000cb', 'other-2099', null)$$, 'пустой лимит (без ограничения) разрешён при записанных');
reset role;
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000b3', 9705, 'Родитель чужого клуба', false);
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-00000000c002', 'Ребёнок чужого клуба', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000b3', 'test', now());

insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000b4', 9706, 'Родитель без записей', false), ('00000000-0000-0000-0000-0000000000b5', 9707, 'Родитель без активного игрока', false);
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-00000000c001', 'Ребёнок без записей', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-0000000000b4', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b5', 'test', now());
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from camp_cancel_terms), 3, 'родитель клуба читает версии условий активных сборов своего клуба');
select is(camp_seats('00000000-0000-0000-0000-0000000000ca'), 0, 'родитель клуба получает свободные места активного сбора');
select throws_ok($$select camp_seats('00000000-0000-0000-0000-0000000000ff')$$, '42501', 'forbidden', 'несуществующий сбор: forbidden, как и чужой (ответ не различается)');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from camp_cancel_terms), 0, 'родитель другого клуба условий отмены не читает');
select throws_ok($$select camp_seats('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'родитель другого клуба не получает места чужого сбора по UUID');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from camp_cancel_terms), 0, 'пользователь без ребёнка в клубе условий отмены не читает');
select throws_ok($$select camp_seats('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'пользователь без ребёнка в клубе не получает свободные места');
reset role;
update camps set active = false where id = '00000000-0000-0000-0000-0000000000cb';
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from camp_cancel_terms), 2, 'условия неактивного сбора родитель не читает');
select throws_ok($$select camp_seats('00000000-0000-0000-0000-0000000000cb')$$, '42501', 'forbidden', 'неактивный сбор: места родителю не отдаются');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_seats('00000000-0000-0000-0000-0000000000cb')$$, 'администратор видит места и неактивного сбора');
select is((select count(*)::int from camp_cancel_terms), 3, 'администратор читает все версии условий');
select as_anon();
select throws_ok($$select camp_seats('00000000-0000-0000-0000-0000000000ca')$$, '42501', null, 'аноним camp_seats не вызывает');

-- ===== Круг 3: прямое изменение лимита и чтение сборов/тарифов =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$update camps set capacity = 2 where id = '00000000-0000-0000-0000-0000000000ca'$$, '22023', 'capacity below registered', 'прямой update лимита ниже подтверждённых (3) запрещён администратору');
select lives_ok($$update camps set capacity = 3 where id = '00000000-0000-0000-0000-0000000000ca'$$, 'прямой update лимита, равного числу подтверждённых, разрешён');
select lives_ok($$update camps set capacity = null where id = '00000000-0000-0000-0000-0000000000ca'$$, 'прямой update: пустой лимит разрешён');
reset role;
update camps set capacity = 3 where id = '00000000-0000-0000-0000-0000000000ca';
select throws_ok($$update camps set capacity = 1 where id = '00000000-0000-0000-0000-0000000000ca'$$, '22023', 'capacity below registered', 'служебная роль и владелец базы лимит ниже подтверждённых тоже не задают');
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from camps), 2, 'родитель видит только активные сборы своего клуба (Зимний и Старый; Другой неактивен)');
select is((select count(*)::int from camp_tariffs), 3, 'родитель видит тарифы только этих сборов');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from camps), 0, 'родитель другого клуба сборов не читает');
select is((select count(*)::int from camp_tariffs), 0, 'родитель другого клуба тарифов не читает');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from camps), 0, 'тренер без ребёнка в клубе сборов не читает');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camps), 3, 'администратор читает все сборы');

-- ===== История родителя после окончания сбора (решение владельца 09.11) =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_pay((select id from ids where k = 'd1'), 300, 'payment', current_date, 'Наличные', null);
select camp_cancel_payment((select id from camp_payments where participant_id = (select id from ids where k = 'd1') and amount = 300));
reset role;
update camps set starts_on = '2020-01-25', ends_on = '2020-02-01' where id = '00000000-0000-0000-0000-0000000000cb';
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camps where id = '00000000-0000-0000-0000-0000000000cb'), 1, 'сбор закончился и неактивен: родитель записанного ребёнка по-прежнему видит сбор');
select is((select status from camp_participants where id = (select id from ids where k = 'd1')), 'cancelled', 'история: запись ребёнка (отменённая) видна родителю');
select is((select count(*)::int from camp_payments where participant_id = (select id from ids where k = 'd1')), 2, 'история: платёж и возврат видны родителю');
select is((select count(*)::int from camp_tariffs where camp_id = '00000000-0000-0000-0000-0000000000cb'), 1, 'история: тариф сбора виден');
select is((select count(*)::int from camp_cancel_terms where camp_id = '00000000-0000-0000-0000-0000000000cb'), 1, 'история: условия отмены сбора видны');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'd1')), 2, 'история: журнал статусов записи виден (запись и отмена)');
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from camps where id = '00000000-0000-0000-0000-0000000000cb'), 0, 'родитель без записей на этот сбор его не видит');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from camps where id = '00000000-0000-0000-0000-0000000000cb'), 0, 'родитель другого клуба этот сбор не видит');
-- родитель без активного игрока: сборы не читает, публичные данные доступны
select as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from camps), 0, 'родитель без активного игрока сборы не читает');
select isnt(camp_public('winter-2099'), null, 'родитель без активного игрока получает публичные данные сбора');

select * from finish();
rollback;
