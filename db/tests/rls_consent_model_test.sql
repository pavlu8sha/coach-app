-- pgTAP (#238, PR 1): модель двух независимых согласий. Только синтетические данные.
-- Проверяем: типы и версии, независимость двух согласий, предикат, неизменяемую историю, RLS и права,
-- «ожидание» без записей и то, что старые данные и старое поведение не тронуты.
begin;
create extension if not exists pgtap;
select plan(72);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 5101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 5102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 5103, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 5104, 'Родитель Б', false),
  ('00000000-0000-0000-0000-0000000000b3', 5105, 'Родитель В (старый отзыв)', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок Б'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок В');
-- Прежняя модель: единое согласие в player_guardians
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'lawyer-2026-11-v1', '2026-11-03 10:00+00'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'draft-2026-10', '2026-10-20 10:00+00');
-- Связь родителя В отозвана по старой модели (consent_revoked_at), запись связи осталась
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'draft-2026-10', '2026-10-21 10:00+00', '2026-11-01 10:00+00');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Версии: по одной на тип (синтетические идентификаторы)
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0001', 'data_processing', 'syn-dp-1', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000f0002', 'media_publication', 'syn-media-1', now() - interval '10 days');

-- Версии и типы
select is(consent_current_version('data_processing'), '00000000-0000-0000-0000-0000000f0001'::uuid, 'текущая версия обязательного согласия');
select is(consent_current_version('media_publication'), '00000000-0000-0000-0000-0000000f0002'::uuid, 'текущая версия публикационного согласия');
select is(consent_current_version('что-то-другое'), null::uuid, 'неизвестный тип версии не имеет');
select throws_ok($$insert into consent_doc_versions (consent_type, version) values ('общее', 'x')$$, '23514', null, 'тип согласия — только из двух');
select throws_ok($$insert into consent_doc_versions (consent_type, version) values ('data_processing', 'syn-dp-1')$$, '23505', null, 'версия типа уникальна');

-- Ожидание без записей: у существующих связей оба согласия pending, прежние сведения видны как исторические
select is((select count(*)::int from parental_consents), 0, 'состояния не созданы (backfill нет)');
select is((select count(*)::int from parental_consent_events), 0, 'истории нет: фиктивных подтверждений не создано');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parental_consent_status), 2, 'у связи два типа согласия');
select is((select count(*)::int from parental_consent_status where status = 'pending' and not is_current), 2, 'оба согласия в ожидании');
select is((select min(legacy_consent_version) from parental_consent_status), 'lawyer-2026-11-v1', 'старая версия сохранена как историческая');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), false, 'старое общее согласие не засчитано как обязательное');
reset role;

-- Старое поведение не изменилось
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(is_guardian_of('00000000-0000-0000-0000-00000000d001'), true, 'доступ по старой модели работает как раньше');
reset role;
select is((select count(*)::int from player_guardians where consent_revoked_at is null), 2, 'связи с детьми не тронуты');

-- Подтверждение обязательного согласия (как будет делать серверная функция следующего этапа)
insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, actor_id, source) overriding system value values
  (1, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001', 'granted', '00000000-0000-0000-0000-0000000000b1', 'app');
insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_actor_id, last_event_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001', 'granted', now(), '00000000-0000-0000-0000-0000000000b1', 1);

select as_user('00000000-0000-0000-0000-0000000000b1');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), true, 'после подтверждения предикат истинен');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d002'), false, 'по чужому ребёнку предикат ложен');
select is((select status from parental_consent_status where consent_type = 'media_publication'), 'pending', 'публикационное согласие не затронуто');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b2');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), false, 'чужой родитель не получает согласие по этому ребёнку');
reset role;

-- Независимость: публикационное согласие и его отзыв не меняют обязательное
insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, actor_id, source) overriding system value values
  (2, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', '00000000-0000-0000-0000-0000000000b1', 'app'),
  (3, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'revoked', '00000000-0000-0000-0000-0000000000b1', 'app');
insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, revoked_at, last_actor_id, last_event_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'revoked', now() - interval '1 hour', now(), '00000000-0000-0000-0000-0000000000b1', 3);
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication'), false, 'отозванное публикационное согласие недействительно');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), true, 'обязательное при этом действует');
select is((select count(*)::int from parental_consent_events where parent_user_id = '00000000-0000-0000-0000-0000000000b1'), 3, 'история хранит каждое событие отдельно');

-- Новая версия: старое подтверждение не даёт доступа
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0003', 'data_processing', 'syn-dp-2', now() - interval '1 minute');
select is(consent_current_version('data_processing'), '00000000-0000-0000-0000-0000000f0003'::uuid, 'текущей стала новая версия');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'подтверждение старой версии больше не даёт согласия');
select is((select is_current from parental_consent_status where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), false, 'в статусе видно, что версия устарела');
-- Версия ещё не вступила в силу или не принимается: текущей остаётся прежняя
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0004', 'data_processing', 'syn-dp-3-future', now() + interval '5 days');
select throws_ok($$update consent_doc_versions set accepting = false where id = '00000000-0000-0000-0000-0000000f0003'$$, '23514', 'the current consent version must stay open for confirmations', 'текущую версию закрыть нельзя: согласия исчезли бы у всех');
select throws_ok($$insert into consent_doc_versions (consent_type, version, effective_from, accepting) values ('data_processing', 'syn-dp-closed-newest', now(), false)$$, '23514', 'the current consent version must stay open for confirmations', 'закрытая версия, которая тут же стала бы текущей, не добавляется');
select is(consent_current_version('data_processing'), '00000000-0000-0000-0000-0000000f0003'::uuid, 'прежняя версия не возвращается и после попыток: текущая остаётся новейшая, будущая текущей не считается');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'после закрытия новейшей версии подтверждение прежней согласия не даёт');
update consent_doc_versions set accepting = false where id = '00000000-0000-0000-0000-0000000f0001';
select is(consent_current_version('data_processing'), '00000000-0000-0000-0000-0000000f0003'::uuid, 'закрытие прежней версии текущую не меняет');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'подтверждение закрытой прежней версии согласия не даёт');

-- Целостность
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (99, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0001', 'granted', 'app')$$, '23503', null, 'версия другого типа в событии не принимается');
select throws_ok($$insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_event_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001', 'granted', now(), 1)$$, '23505', null, 'одна строка состояния на родитель + ребёнок + тип');
select throws_ok($$insert into parental_consents (parent_user_id, player_id, consent_type, status) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d002', 'data_processing', 'granted')$$, '23514', null, 'granted без версии, времени и события не записывается');

-- История неизменяема
select throws_ok($$update parental_consent_events set event = 'granted' where id = 3$$, '42501', 'consent history is append-only', 'запись истории нельзя изменить');
select throws_ok($$delete from parental_consent_events where id = 1$$, '42501', 'consent history is append-only', 'запись истории нельзя удалить');
select throws_ok($$truncate parental_consent_events cascade$$, '42501', 'consent history is append-only', 'историю нельзя очистить');

-- RLS и права
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parental_consent_events), 3, 'родитель видит свою историю');
select throws_ok($$insert into parental_consent_events (parent_user_id, player_id, consent_type, version_id, event, source) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', 'app')$$, '42501', null, 'родитель не пишет историю напрямую');
select throws_ok($$update parental_consents set status = 'granted'$$, '42501', null, 'родитель не меняет состояние напрямую');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from parental_consent_events) + (select count(*)::int from parental_consents), 0, 'чужой родитель чужих согласий не видит');
reset role;
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from parental_consent_events) + (select count(*)::int from parental_consents), 0, 'тренер согласий родителей не видит');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from parental_consent_events), 3, 'администратор видит историю');
reset role;
select is(
  (select count(*)::int from pg_proc p where p.proname in ('my_data_consent_ok', 'consent_current_version', 'has_consent') and has_function_privilege('anon', p.oid, 'execute')),
  0, 'гость (anon) новые функции не вызывает');
select is(has_function_privilege('authenticated', 'has_consent(uuid, uuid, text)', 'execute'), false, 'внутренний предикат из приложения не вызывается');

-- Согласие только по существующей связи этого родителя (запрос на связь, даже действующий, связью не считается)
insert into link_requests (user_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d001', 'rejected');
select throws_ok($$insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_event_id) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', now(), 1)$$, '23503', 'no guardian link for this parent and child', 'состояние за чужого ребёнка не создаётся');
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (98, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', 'app')$$, '23503', 'no guardian link for this parent and child', 'событие за чужого ребёнка не записывается (отклонённый запрос связью не считается)');
insert into link_requests (user_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d002', 'pending');
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (97, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d002', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', 'app')$$, '23503', 'no guardian link for this parent and child', 'ожидающий запрос на связь связью не считается: согласие по нему не принимается');

-- Повторное принятие после старого отзыва: связь родителя В есть, новый режим даёт согласие без новой привязки и без правки старых строк
select as_user('00000000-0000-0000-0000-0000000000b3');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d003'), false, 'после старого отзыва новое согласие ещё не принято');
reset role;
select is((select count(*)::int from player_guardians where player_id = '00000000-0000-0000-0000-00000000d003' and consent_revoked_at is not null), 1, 'старый отзыв записан в связи');
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0005', 'data_processing', 'syn-dp-4', now() - interval '1 second');
insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, actor_id, source) overriding system value values
  (96, '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000d003', 'data_processing', '00000000-0000-0000-0000-0000000f0005', 'granted', '00000000-0000-0000-0000-0000000000b3', 'app');
insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_actor_id, last_event_id) values
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000d003', 'data_processing', '00000000-0000-0000-0000-0000000f0005', 'granted', now(), '00000000-0000-0000-0000-0000000000b3', 96);
select as_user('00000000-0000-0000-0000-0000000000b3');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d003'), true, 'после повторного принятия обязательное согласие действует');
reset role;
select is((select count(*)::int from player_guardians where player_id = '00000000-0000-0000-0000-00000000d003'), 1, 'дублирующей связи не создано');
select is((select consent_version from player_guardians where player_id = '00000000-0000-0000-0000-00000000d003'), 'draft-2026-10', 'старые сведения связи не изменены');

-- Публикационное согласие не блокирует: родитель А отозвал публикационное, обязательное действует по новой модели
select as_user('00000000-0000-0000-0000-0000000000b3');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d003'), true, 'обязательное согласие не зависит от публикационного (публикационного нет вовсе)');
reset role;

-- Состояние привязано к своей паре и своей истории
select throws_ok($$update parental_consents set parent_user_id = '00000000-0000-0000-0000-0000000000b2' where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'$$, '42501', 'consent state identity is immutable', 'состояние нельзя перенести на другого родителя');
select throws_ok($$insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_event_id) values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000d003', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', now(), 1)$$, '23514', 'state must follow the latest own history event', 'состояние не ссылается на событие другого родителя и другого типа');
select throws_ok($$insert into parental_consents (parent_user_id, player_id, consent_type, version_id, status, granted_at, last_event_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', now(), 3)$$, '23514', 'state must follow the latest own history event', 'granted не ссылается на событие отзыва');
select throws_ok($$update parental_consents set status = 'granted', granted_at = now(), last_event_id = 2 where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'media_publication'$$, '23514', 'state must follow the latest own history event', 'состояние ссылается только на последнее событие');

-- Версии: принимаются только действующие, подпись нельзя переписать
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (95, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001', 'granted', 'app')$$, '23514', 'consent version is not accepted now', 'подтверждение закрытой версии не записывается');
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (94, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0004', 'granted', 'app')$$, '23514', 'consent version is not accepted now', 'подтверждение ещё не вступившей версии не записывается');
select throws_ok($$update consent_doc_versions set version = 'переписано' where id = '00000000-0000-0000-0000-0000000f0002'$$, '42501', null, 'название принятой версии менять нельзя');
select throws_ok($$update consent_doc_versions set text_ref = 'syn-ref-0' where id = '00000000-0000-0000-0000-0000000f0002'$$, '42501', null, 'ссылку на текст нельзя задать после первого подтверждения');
select lives_ok($$update consent_doc_versions set text_ref = 'syn-ref-1' where id = '00000000-0000-0000-0000-0000000f0004'$$, 'ссылку на текст версии без подтверждений можно задать один раз');
select throws_ok($$update consent_doc_versions set text_ref = 'syn-ref-2' where id = '00000000-0000-0000-0000-0000000f0004'$$, '42501', null, 'заданную ссылку на текст менять нельзя');

-- Связь удалена (например, erase_parent): согласие недействительно, пока связи нет
delete from player_guardians where user_id = '00000000-0000-0000-0000-0000000000b3';
select as_user('00000000-0000-0000-0000-0000000000b3');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d003'), false, 'без связи согласие не действует');
reset role;

-- Равные даты вступления: текущая — добавленная позже
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0011', 'media_publication', 'syn-media-tie-a', now() - interval '1 second'),
  ('00000000-0000-0000-0000-0000000f0010', 'media_publication', 'syn-media-tie-b', now() - interval '1 second');
select is(consent_current_version('media_publication'), '00000000-0000-0000-0000-0000000f0010'::uuid, 'при равных датах текущая — добавленная позже, а не по случайному идентификатору');

-- Подмена таблицы временной не даёт согласия
select as_user('00000000-0000-0000-0000-0000000000b2');
create temp table parental_consents (parent_user_id uuid, player_id uuid, consent_type text, status text, version_id uuid);
insert into pg_temp.parental_consents values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d002', 'data_processing', 'granted', (select consent_current_version('data_processing')));
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d002'), false, 'родитель со связью и без согласия: временная таблица с тем же именем не подменяет проверку');
drop table pg_temp.parental_consents;
reset role;

-- Права service_role на внутренние функции
select is(
  (select count(*)::int from pg_proc p where p.proname in ('my_data_consent_ok', 'consent_current_version', 'has_consent', 'parental_consent_link_check', 'parental_consent_event_guard', 'parental_consent_state_guard', 'consent_doc_versions_guard') and has_function_privilege('service_role', p.oid, 'execute')),
  0, 'service_role новые функции напрямую не вызывает');

-- Отзыв после исчезновения связи записывается; состояние меняется только вместе с новым событием
insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, actor_id, source) overriding system value values
  (93, '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000d003', 'data_processing', '00000000-0000-0000-0000-0000000f0005', 'revoked', '00000000-0000-0000-0000-0000000000a1', 'admin');
select is((select count(*)::int from parental_consent_events where id = 93), 1, 'отзыв обязательного согласия записывается и после исчезновения связи (по существующей истории)');
select throws_ok($$insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source) overriding system value values (92, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d003', 'data_processing', '00000000-0000-0000-0000-0000000f0005', 'revoked', 'admin')$$, '23503', 'no guardian link for this parent and child', 'отзыв без истории и без связи не записывается');
select throws_ok($$update parental_consents set status = 'pending', version_id = null, last_event_id = null, granted_at = null where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'$$, '23514', 'consent state cannot return to pending', 'состояние нельзя вернуть в ожидание');
select throws_ok($$update parental_consents set granted_at = '2020-01-01' where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'$$, '23514', 'state changes require a new history event', 'время состояния не меняется без нового события');
select lives_ok($$update consent_doc_versions set version = 'syn-dp-3-moved', effective_from = now() + interval '9 days' where id = '00000000-0000-0000-0000-0000000f0004'$$, 'версию, которую никто не подтверждал, можно исправить');

-- Время события задаёт сервер
insert into parental_consent_events (id, parent_user_id, player_id, consent_type, version_id, event, source, occurred_at) overriding system value values
  (91, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0010', 'granted', 'app', '2020-01-01');
select is((select occurred_at from parental_consent_events where id = 91), now(), 'подставленное время события игнорируется, время ставит сервер');

select * from finish();
rollback;
