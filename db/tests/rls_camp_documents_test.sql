-- pgTAP: самозапись на сборы, этап 5 (0169, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 37-38):
-- документы сбора: версии, замена, доступ только подтверждённым участникам, уведомление о публикации.
begin;
create extension if not exists pgtap;
select plan(76);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9931, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9932, 'Родитель записанных', false),
  ('00000000-0000-0000-0000-0000000000b2', 9933, 'Родитель отменившего', false),
  ('00000000-0000-0000-0000-0000000000b3', 9934, 'Родитель неучастника', false),
  ('00000000-0000-0000-0000-0000000000b4', 9935, 'Гость подтверждённый', false),
  ('00000000-0000-0000-0000-0000000000b5', 9936, 'Гость с новой заявкой', false),
  ('00000000-0000-0000-0000-0000000000b6', 9937, 'Родитель с отозванным согласием', false),
  ('00000000-0000-0000-0000-0000000000c1', 9938, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 9939, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000d2', 9940, 'Локальный админ другого места', false);
insert into location_admins (user_id, location) values
  ('00000000-0000-0000-0000-0000000000d1', 'Исани'), ('00000000-0000-0000-0000-0000000000d2', 'Чиковани');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'Гена', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', 'Дима', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now()),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b6', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Другой сбор', 'Исани', '2099-02-03', '2099-02-10');
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000cb', 'Другой', 1000, true);
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
create or replace function as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
grant execute on function as_user(uuid), as_service(), as_anon() to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;
create or replace function nq(u uuid) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = 'camp_document' and user_id = u
$$;
create or replace function nhas(u uuid, pat text) returns boolean language sql security definer as $$
  select exists (select 1 from notifications where kind = 'camp_document' and user_id = u and text like pat)
$$;
grant execute on function nq(uuid), nhas(uuid, text) to public;

-- Участники: Аня и Боря записаны (родитель 1), Вася отменил (родитель 2), Гена не записан, Дима записан, согласие потом отозвано;
-- гость подтверждён (b4), у b5 новая заявка
select as_user('00000000-0000-0000-0000-0000000000b1');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_parent_cancel(camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null));
select as_user('00000000-0000-0000-0000-0000000000b6');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b4');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Подтверждённый', '2015-01-01', 'Папа', '555 11 11 11', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b5');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Новый', '2015-02-02', 'Мама', '555 22 22 22', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Подтверждённый'), true, null);
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b6';

-- ===== 37. Загрузка: только администратор, проверка названия и размера =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа', 1000, null)$$, '42501', 'forbidden', 'родитель документ не загружает');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа', 1000, null)$$, '42501', 'forbidden', 'локальный администратор документ не загружает');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', '  ', 1000, null)$$, '22023', 'bad document', 'пустое название отклоняется');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', repeat('я', 121), 1000, null)$$, '22023', 'bad document', 'слишком длинное название отклоняется');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа', 0, null)$$, '22023', 'bad document', 'пустой файл отклоняется');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа', 10485761, null)$$, '22023', 'bad document', 'файл больше 10 МБ отклоняется');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-000000000000', 'Программа', 1000, null)$$, 'P0002', 'camp not found', 'несуществующий сбор');
insert into ids select 'd1', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', ' Программа сбора ', 1000, null)->>'id')::uuid;
select ok((select storage_path like '00000000-0000-0000-0000-0000000000ca/%.pdf' and status = 'pending' and version = 1 and title = 'Программа сбора' and uploaded_by = '00000000-0000-0000-0000-0000000000a1' from camp_document_admin_list('00000000-0000-0000-0000-0000000000ca') where id = (select id from ids where k = 'd1')), 'заявка на загрузку: путь внутри папки сбора, статус pending, версия 1, автор');
select throws_ok($$select camp_document_finish((select id from ids where k = 'd1'), true)$$, '42501', null, 'публикацию после загрузки подтверждает только сервер');
select is(nq('00000000-0000-0000-0000-0000000000b1'), 0, 'до подтверждения загрузки уведомлений нет');

-- ===== 38. Доступ: пока файл не загружен, документ никому не виден =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 0, 'незагруженный документ участник не видит');
select throws_ok($$select camp_document_path((select id from ids where k = 'd1'))$$, '42501', 'forbidden', 'ссылку на незагруженный документ получить нельзя');
select as_service();
select lives_ok($$select camp_document_finish((select id from ids where k = 'd1'), true)$$, 'сервер подтверждает загрузку');
select throws_ok($$select camp_document_finish((select id from ids where k = 'd1'), true)$$, '22023', 'not pending', 'повторное подтверждение отклоняется');

-- ===== 34. Уведомление о публикации: родителям подтверждённых участников =====
select is(nq('00000000-0000-0000-0000-0000000000b1'), 1, 'родитель двух записанных детей получает одно сообщение');
select ok(nhas('00000000-0000-0000-0000-0000000000b1', '%Зимний сбор%') and nhas('00000000-0000-0000-0000-0000000000b1', '%Программа сбора%') and nhas('00000000-0000-0000-0000-0000000000b1', '%опубликован%'), 'в сообщении сбор, название документа и «опубликован»');
select is(nq('00000000-0000-0000-0000-0000000000b4'), 1, 'владелец подтверждённой гостевой записи получает сообщение');
select is(nq('00000000-0000-0000-0000-0000000000b2') + nq('00000000-0000-0000-0000-0000000000b3') + nq('00000000-0000-0000-0000-0000000000b5') + nq('00000000-0000-0000-0000-0000000000b6') + nq('00000000-0000-0000-0000-0000000000a1'), 0, 'отменивший, неучастник, новая заявка, отозванное согласие и администратор сообщение не получают');

-- ===== 38. Доступ к опубликованному документу =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select title || '|' || version from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 'Программа сбора|1', 'родитель записанного ребёнка видит документ');
select ok(camp_document_path((select id from ids where k = 'd1')) like '00000000-0000-0000-0000-0000000000ca/%.pdf', 'родитель записанного ребёнка получает путь к файлу');
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 1, 'владелец подтверждённой гостевой записи видит документ');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select * from camp_documents_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'отменивший участник документы не видит');
select throws_ok($$select camp_document_path((select id from ids where k = 'd1'))$$, '42501', 'forbidden', 'отменивший участник путь не получает');
select as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select * from camp_documents_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'родитель неучастника документы не видит');
select as_user('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$select camp_document_path((select id from ids where k = 'd1'))$$, '42501', 'forbidden', 'заявитель с новой заявкой путь не получает');
select as_user('00000000-0000-0000-0000-0000000000b6');
select throws_ok($$select * from camp_documents_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'родитель с отозванным согласием документы не видит');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select camp_document_path((select id from ids where k = 'd1'))$$, '42501', 'forbidden', 'тренер путь не получает');
select as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select * from camp_documents_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'локальный администратор другого места документы не видит');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 1, 'локальный администратор места сбора документы читает');
select throws_ok($$select * from camp_document_admin_list('00000000-0000-0000-0000-0000000000ca')$$, '42501', 'forbidden', 'список всех версий только администратору');
select as_anon();
select throws_ok($$select camp_document_path('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'аноним путь не получает');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_document_path('00000000-0000-0000-0000-000000000000')$$, '42501', 'forbidden', 'несуществующий документ не раскрывается');
select throws_ok($$select count(*) from camp_documents$$, '42501', null, 'прямого чтения таблицы документов нет');
select throws_ok($$select * from camp_documents_list('00000000-0000-0000-0000-0000000000cb')$$, '42501', 'forbidden', 'участник одного сбора документы другого сбора не видит');

-- ===== 37. Замена: новая версия, прежняя остаётся в истории =====
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'd2', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа сбора (обновлено)', 2000, (select id from ids where k = 'd1'))->>'id')::uuid;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select title || '|' || version from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 'Программа сбора|1', 'пока новая версия не загружена, участник видит прежнюю');
select as_service();
select camp_document_finish((select id from ids where k = 'd2'), true);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select title || '|' || version from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 'Программа сбора (обновлено)|2', 'после загрузки участник видит только новую версию');
select throws_ok($$select camp_document_path((select id from ids where k = 'd1'))$$, '42501', 'forbidden', 'путь к прежней версии участнику не выдаётся');
select ok(nhas('00000000-0000-0000-0000-0000000000b1', '%обновлён%') and nq('00000000-0000-0000-0000-0000000000b1') = 2, 'об обновлении документа приходит отдельное сообщение');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camp_document_admin_list('00000000-0000-0000-0000-0000000000ca')), 2, 'администратор видит обе версии');
select ok(camp_document_path((select id from ids where k = 'd1')) is not null, 'администратор получает путь и к прежней версии');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000cb', 'Чужая замена', 1000, (select id from ids where k = 'd1'))$$, '22023', 'bad document', 'замена документа другого сбора отклоняется');
-- неудачная загрузка
insert into ids select 'd3', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Сорвалась', 1000, null)->>'id')::uuid;
select as_service();
select camp_document_finish((select id from ids where k = 'd3'), false);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 1, 'сорвавшаяся загрузка участникам не видна');
select is(nq('00000000-0000-0000-0000-0000000000b1'), 2, 'сорвавшаяся загрузка уведомление не шлёт');

-- ===== Снятие документа и неизменяемость =====
select throws_ok($$select camp_document_remove((select id from ids where k = 'd2'))$$, '42501', 'forbidden', 'родитель документ не снимает');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_document_remove((select id from ids where k = 'd2'))$$, 'администратор снимает документ');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 0, 'снятый документ (все его версии) участник не видит');
select throws_ok($$select camp_document_path((select id from ids where k = 'd2'))$$, '42501', 'forbidden', 'путь к снятому документу не выдаётся');
reset role;
select is((select count(*)::int from camp_documents where camp_id = '00000000-0000-0000-0000-0000000000ca'), 3, 'строки документов остаются в истории');

-- ===== Находки и защита: история, лимиты, сервер, выключатель =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Замена снятого', 1000, (select id from ids where k = 'd2'))$$, '22023', 'bad document', 'снятый документ заменить нельзя');
select throws_ok($$select camp_document_remove('00000000-0000-0000-0000-000000000000')$$, 'P0002', 'document not found', 'снятие несуществующего документа');
select throws_ok($$delete from camp_documents$$, '42501', null, 'администратор строки документов напрямую не удаляет');
select throws_ok($$update camp_documents set status = 'ready'$$, '42501', null, 'администратор строки документов напрямую не правит');
select as_service();
select throws_ok($$update camp_documents set status = 'ready'$$, '42501', null, 'сервер строки документов напрямую не правит');
select throws_ok($$insert into camp_documents (camp_id, doc_id, version, title, size_bytes, storage_path) values ('00000000-0000-0000-0000-0000000000ca', gen_random_uuid(), 1, 'x', 1, 'x')$$, '42501', null, 'сервер строки документов напрямую не добавляет');
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Программа', 1000, null)$$, '42501', null, 'сервер загрузку не начинает');
reset role;
select throws_ok($$delete from camp_documents where id = (select id from ids where k = 'd1')$$, 'P0001', 'immutable', 'строка документа не удаляется даже владельцем базы');
select throws_ok($$truncate camp_documents$$, 'P0001', 'immutable', 'таблица документов не очищается');
-- брошенная загрузка: через час считается сорвавшейся, поздний файл не публикуется
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'd4', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Брошенная', 1000, null)->>'id')::uuid;
reset role;
update camp_documents set created_at = now() - interval '2 hours' where id = (select id from ids where k = 'd4');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'd5', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Памятка', 1000, null)->>'id')::uuid;
select as_service();
select throws_ok($$select camp_document_finish((select id from ids where k = 'd4'), true)$$, '22023', 'not pending', 'брошенная загрузка позже не публикуется');
-- снятие до окончания загрузки: файл дозагружается, но участникам не виден и сообщение не уходит
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_document_remove((select id from ids where k = 'd5'));
select as_service();
select camp_document_finish((select id from ids where k = 'd5'), true);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 0, 'документ, снятый во время загрузки, участникам не виден');
select is(nq('00000000-0000-0000-0000-0000000000b1'), 2, 'о снятом документе сообщение не уходит');
-- частые замены: не больше трёх сообщений на документ за сутки
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'e1', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Список вещей', 1000, null)->>'id')::uuid;
select as_service();
select camp_document_finish((select id from ids where k = 'e1'), true);
do $$
declare i int; prev uuid := (select id from ids where k = 'e1'); n uuid;
begin
  for i in 2..5 loop
    perform as_user('00000000-0000-0000-0000-0000000000a1');
    n := (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Список вещей', 1000, prev)->>'id')::uuid;
    perform as_service();
    perform camp_document_finish(n, true);
    prev := n;
  end loop;
end $$;
select is(nq('00000000-0000-0000-0000-0000000000b1'), 5, 'пять версий за сутки дают три сообщения, а не пять');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select title || '|' || version from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 'Список вещей|5', 'участник видит последнюю версию');
-- отмена записи закрывает доступ сразу
select as_user('00000000-0000-0000-0000-0000000000b4');
select ok(camp_document_path((select d.id from camp_documents_list('00000000-0000-0000-0000-0000000000ca') d)) is not null, 'гость с подтверждённой записью получает путь');
insert into ids select 'cur', d.id from camp_documents_list('00000000-0000-0000-0000-0000000000ca') d;
select camp_parent_cancel((select id from camp_participants where owner_user_id = '00000000-0000-0000-0000-0000000000b4'));
select throws_ok($$select camp_document_path((select id from ids where k = 'cur'))$$, '42501', 'forbidden', 'после отмены записи путь не выдаётся');
-- выключатель camps.notify
reset role;
update club_settings set value = 'off' where key = 'camps.notify';
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'f1', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Тихий документ', 1000, null)->>'id')::uuid;
select as_service();
select camp_document_finish((select id from ids where k = 'f1'), true);
select is(nq('00000000-0000-0000-0000-0000000000b1'), 5, 'при выключенном camps.notify сообщение о документе не ставится');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_documents_list('00000000-0000-0000-0000-0000000000ca')), 2, 'документ при этом опубликован');
-- лимит: не больше 20 действующих документов на сбор
select as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin for i in 1..20 loop perform camp_document_begin('00000000-0000-0000-0000-0000000000cb', 'Документ ' || i, 1000, null); end loop; end $$;
select throws_ok($$select camp_document_begin('00000000-0000-0000-0000-0000000000cb', 'Лишний', 1000, null)$$, '22023', 'too many documents', 'двадцать первый документ сбора отклоняется');

-- ===== Находки независимой проверки =====
-- 1. сбор с документами не удаляется, строки остаются
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$delete from camps where id = '00000000-0000-0000-0000-0000000000cb'$$, '42501', null, 'администратор не удаляет сбор прямым запросом (права сняты в 0191)');
reset role;
select throws_ok($$delete from camps where id = '00000000-0000-0000-0000-0000000000cb'$$, '23503', null, 'сбор с документами не удаляется и владельцем базы');
select is((select count(*)::int from camp_documents where camp_id = '00000000-0000-0000-0000-0000000000cb'), 20, 'строки документов сбора на месте');
-- 2. брошенная загрузка не публикуется и без новой загрузки
update club_settings set value = 'on' where key = 'camps.notify';
update camp_documents set created_at = now() - interval '2 hours' where title = 'Документ 1';
select as_service();
select throws_ok($$select camp_document_finish((select id from camp_documents where title = 'Документ 1'), true)$$, '22023', 'not pending', 'загрузка старше часа не публикуется, даже если новых загрузок не было');
-- 3. две замены одной версии: побеждает последняя начатая, первая не публикуется и не уведомляет
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'r1', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Замена А', 1000, (select id from ids where k = 'f1'))->>'id')::uuid;
insert into ids select 'r2', (camp_document_begin('00000000-0000-0000-0000-0000000000ca', 'Замена Б', 1000, (select id from ids where k = 'f1'))->>'id')::uuid;
select as_service();
select camp_document_finish((select id from ids where k = 'r2'), true);
select throws_ok($$select camp_document_finish((select id from ids where k = 'r1'), true)$$, '22023', 'not pending', 'ранее начатая замена после новой не публикуется');
select ok(not nhas('00000000-0000-0000-0000-0000000000b1', '%Замена А%'), 'о неопубликованной замене сообщения нет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select ok(exists (select 1 from camp_documents_list('00000000-0000-0000-0000-0000000000ca') where title = 'Замена Б'), 'участник видит последнюю замену');
-- 6. не больше пяти сообщений о документах одному человеку за сутки (у родителя их уже пять)
select is(nq('00000000-0000-0000-0000-0000000000b1'), 5, 'шестое сообщение о документах за сутки не ставится');
reset role;
select is(nq('00000000-0000-0000-0000-0000000000b6'), 0, 'родитель с отозванным согласием сообщений о документах не получил');

select * from finish();
rollback;
