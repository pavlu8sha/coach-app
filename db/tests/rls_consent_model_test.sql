-- pgTAP (#238, PR 1): модель двух независимых согласий. Только синтетические данные.
-- Проверяем: типы и версии, независимость двух согласий, предикат, неизменяемую историю, RLS и права,
-- «ожидание» без записей и то, что старые данные и старое поведение не тронуты.
begin;
create extension if not exists pgtap;
select plan(40);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 5101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 5102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 5103, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 5104, 'Родитель Б', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок Б');
-- Прежняя модель: единое согласие в player_guardians
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'lawyer-2026-11-v1', '2026-11-03 10:00+00'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'draft-2026-10', '2026-10-20 10:00+00');

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
update consent_doc_versions set accepting = false where id = '00000000-0000-0000-0000-0000000f0003';
select is(consent_current_version('data_processing'), '00000000-0000-0000-0000-0000000f0001'::uuid, 'будущая и неприменяемая версии текущими не считаются');
update consent_doc_versions set accepting = false where consent_type = 'data_processing';
select is(consent_current_version('data_processing'), null::uuid, 'нет принимаемой версии — текущей нет');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'нет текущей версии — согласия нет');

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

select * from finish();
rollback;
