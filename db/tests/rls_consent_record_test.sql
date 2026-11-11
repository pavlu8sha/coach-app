-- pgTAP (#238, PR 2a): принятие и отзыв двух согласий, разрыв и пересоздание связи. Только синтетические данные.
-- Условия приёмки: docs/CONSENT_PR2A_ACCEPTANCE.md (П1-П10, С1-С5).
begin;
create extension if not exists pgtap;
select plan(75);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 6101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 6103, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 6104, 'Родитель Б', false),
  ('00000000-0000-0000-0000-0000000000b3', 6105, 'Родитель В (старый отзыв)', false),
  ('00000000-0000-0000-0000-0000000000b4', 6106, 'Родитель Г (только запрос)', false);
insert into players (id, club_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Ребёнок Б'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Ребёнок В'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'Ребёнок Г');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'lawyer-2026-11-v1', '2026-11-03 10:00+00'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'lawyer-2026-11-v1', '2026-11-03 10:00+00');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'draft-2026-10', '2026-10-21 10:00+00', '2026-11-01 10:00+00');
insert into link_requests (user_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000d004', 'pending');
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0001', 'data_processing', 'syn-dp-1', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000f0002', 'media_publication', 'syn-media-1', now() - interval '10 days');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table legacy_before as select user_id, player_id, consent_version, consent_given_at, consent_revoked_at from player_guardians;
grant select on legacy_before to authenticated;

-- П1: принятие по существующей связи без новой привязки и без администратора
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001')$$, 'родитель принимает обязательное согласие по своей связи');
select is((select status from parental_consents where player_id = '00000000-0000-0000-0000-00000000d001' and consent_type = 'data_processing'), 'granted', 'состояние granted');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), true, 'предикат обязательного согласия истинен');
-- П4: идемпотентность
select is((accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001') ->> 'changed')::boolean, false, 'повторное принятие той же версии ничего не меняет');
select is((select count(*)::int from parental_consent_events), 1, 'повтор не создал нового события');
-- П6: независимость типов
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002')$$, 'публикационное согласие принимается отдельно');
reset role;
select is((select count(*)::int from parental_consent_events), 2, 'два типа: два события');
select is((select e.occurred_at = c.granted_at from parental_consents c join parental_consent_events e on e.id = c.last_event_id where c.consent_type = 'data_processing'), true, 'П7: время состояния равно времени события');
select is((select count(*)::int from audit_log where action = 'consent_granted' and entity = 'parental_consents'), 2, 'П8: принятия записаны в аудит');

-- П2: чужой ребёнок, нет связи, ожидающий запрос, не вошедший
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001')$$, '42501', 'no guardian link for this parent and child', 'за чужого ребёнка принять нельзя');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d004', 'data_processing', '00000000-0000-0000-0000-0000000f0001')$$, '42501', 'no guardian link for this parent and child', 'ожидающий запрос на связь связью не считается');
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('role', 'authenticated', true);
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001')$$, '42501', 'not authenticated', 'без входа принять нельзя');
reset role;
select is((select count(*)::int from parental_consents where parent_user_id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b4')), 0, 'отказы не создали согласий');

-- П3: версии и типы
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d002', 'общее', '00000000-0000-0000-0000-0000000f0001')$$, '22023', 'unknown consent type', 'неизвестный тип отклоняется');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d002', 'data_processing', '00000000-0000-0000-0000-0000000f0002')$$, '23514', 'consent version changed', 'версия другого типа отклоняется');
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0003', 'data_processing', 'syn-dp-future', now() + interval '5 days');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d002', 'data_processing', '00000000-0000-0000-0000-0000000f0003')$$, '23514', 'consent version changed', 'будущая версия не принимается');
reset role;
-- Новая текущая версия: подтверждение прежней устарело, принять нужно новую
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('00000000-0000-0000-0000-0000000f0004', 'data_processing', 'syn-dp-2', now() - interval '1 minute');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), false, 'после новой версии старое подтверждение не действует');
select throws_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0001')$$, '23514', 'consent version changed', 'устаревшая версия отклоняется (кеш приложения)');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0004')$$, 'принятие новой версии');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), true, 'доступ по новой версии');
reset role;
select is((select count(*)::int from parental_consent_events where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), 2, 'П4: история сохранила и старое, и новое подтверждение');

-- П5, П6: отзыв
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'media_publication')$$, 'отзыв публикационного согласия');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), true, 'отзыв публикационного не блокирует доступ');
select is((select status from parental_consent_status where consent_type = 'media_publication'), 'revoked', 'публикационное согласие отозвано');
select is((select status from parental_consent_status where consent_type = 'data_processing'), 'granted', 'обязательное не затронуто');
select is((revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'media_publication') ->> 'changed')::boolean, false, 'повторный отзыв идемпотентен');
reset role;
select is((select count(*)::int from parental_consent_events where event = 'revoked'), 1, 'повторный отзыв события не создал');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((revoke_parent_consent('00000000-0000-0000-0000-00000000d002', 'data_processing') ->> 'changed')::boolean, false, 'отзыв непринятого согласия ничего не делает');
reset role;
select is((select count(*)::int from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'и не создаёт строк состояния');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'data_processing')$$, 'отзыв обязательного согласия');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), false, 'после отзыва обязательного предикат ложен');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0004')$$, 'повторное принятие после отзыва');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d001'), true, 'доступ восстановлен без новой привязки');
select throws_ok($$select revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'другое')$$, '22023', 'unknown consent type', 'отзыв неизвестного типа отклоняется');
reset role;
select is((select count(*)::int from audit_log where action = 'consent_revoked' and entity = 'parental_consents'), 2, 'П8: отзывы записаны в аудит');

-- П9: повторное принятие после старого отзыва; старые поля не меняются
select as_user('00000000-0000-0000-0000-0000000000b3');
select is(is_guardian_of('00000000-0000-0000-0000-00000000d003'), false, 'старая модель: доступ после старого отзыва закрыт');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d003', 'data_processing', '00000000-0000-0000-0000-0000000f0004')$$, 'принятие после старого отзыва без новой привязки');
select is(my_data_consent_ok('00000000-0000-0000-0000-00000000d003'), true, 'новое согласие действует');
select is(is_guardian_of('00000000-0000-0000-0000-00000000d003'), false, 'старые функции доступа не изменены (PR 2a не включает доступ)');
reset role;
select is((select count(*)::int from player_guardians g join legacy_before l using (user_id, player_id)
            where g.consent_version is distinct from l.consent_version or g.consent_given_at is distinct from l.consent_given_at or g.consent_revoked_at is distinct from l.consent_revoked_at), 0, 'П9: старые consent_* не изменены никакой функцией');

-- П10: права
select is((select count(*)::int from pg_proc where proname in ('accept_consent', 'revoke_parent_consent') and has_function_privilege('anon', oid, 'execute')), 0, 'гостю (anon) функции согласий недоступны');
-- PUBLIC — псевдороль: проверяем через ACL функции (grantee = 0), в том числе для служебных функций
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('accept_consent', 'revoke_parent_consent', 'consent_record', 'consent_on_link_delete', 'consent_versions_lock', 'consent_links_lock')
            and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 0, 'PUBLIC не имеет EXECUTE на функциях согласий (по ACL)');
select is((select count(*)::int from pg_proc where proname in ('accept_consent', 'revoke_parent_consent') and has_function_privilege('authenticated', oid, 'execute')), 2, 'вошедшему доступны две функции');
select is((select count(*)::int from pg_proc where proname in ('consent_record', 'consent_on_link_delete', 'consent_versions_lock', 'consent_links_lock')
            and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute'))), 0, 'внутренние функции записи недоступны ролям приложения и service_role');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into parental_consent_events (parent_user_id, player_id, consent_type, version_id, event, source) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'granted', 'app')$$, '42501', null, 'прямая запись истории родителю по-прежнему закрыта');
reset role;

-- С1, С2: разрыв связи записывает отзыв только по действующим типам
select is((select status from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), 'granted', 'до разрыва: обязательное принято');
select lives_ok($$delete from player_guardians where user_id = '00000000-0000-0000-0000-0000000000b1' and player_id = '00000000-0000-0000-0000-00000000d001'$$, 'связь удалена');
select is((select count(*)::int from parental_consent_events where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and event = 'revoked' and source = 'system'), 1, 'С1: системный отзыв записан по одному действующему типу');
select is((select count(*)::int from parental_consent_events where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'media_publication' and event = 'revoked'), 1, 'С2: уже отозванное публикационное повторно не отзывается');
select is((select status from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), 'revoked', 'состояние обязательного отозвано');
select is((select actor_id from parental_consent_events where source = 'system' and parent_user_id = '00000000-0000-0000-0000-0000000000b1'), null::uuid, 'у системного события нет инициатора-пользователя');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'без связи согласия нет');
-- С5: пересоздание связи не оживляет согласие
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'lawyer-2026-11-v1', now());
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'С5: после новой привязки прежнее согласие не действует');
-- С4: сохранившееся granted при создании новой связи отзывается в decide_link
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d001', 'data_processing', '00000000-0000-0000-0000-0000000f0004')$$, 'родитель снова принимает согласие');
reset role;
alter table player_guardians disable trigger user;
delete from player_guardians where user_id = '00000000-0000-0000-0000-0000000000b1' and player_id = '00000000-0000-0000-0000-00000000d001';
alter table player_guardians enable trigger user;
select is((select status from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), 'granted', 'связь убрана в обход триггера: состояние granted осталось без связи');
insert into link_requests (user_id, player_id, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'pending')
  on conflict (user_id, player_id) do update set status = 'pending';
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select decide_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b1' and player_id = '00000000-0000-0000-0000-00000000d001'), true)$$, 'администратор одобряет новую связь');
reset role;
select is((select status from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b1' and consent_type = 'data_processing'), 'revoked', 'С4: при создании новой связи оставшееся согласие отозвано');
select is(has_consent('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'data_processing'), false, 'новая привязка требует нового принятия');
-- С4: повторное одобрение существующей связи не отнимает согласие
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select accept_consent('00000000-0000-0000-0000-00000000d002', 'data_processing', '00000000-0000-0000-0000-0000000f0004')$$, 'родитель Б принимает согласие');
reset role;
insert into link_requests (user_id, player_id, status) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d002', 'pending');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select decide_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b2' and player_id = '00000000-0000-0000-0000-00000000d002'), true)$$, 'повторное одобрение существующей связи');
reset role;
select is(has_consent('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d002', 'data_processing'), true, 'С4: действующее согласие по существующей связи сохранилось');
-- С3: erase_parent
insert into data_requests (user_id, kind) values ('00000000-0000-0000-0000-0000000000b2', 'delete');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select erase_parent((select id from data_requests where user_id = '00000000-0000-0000-0000-0000000000b2' and status = 'open'))$$, 'erase_parent работает как раньше');
reset role;
select is((select count(*)::int from player_guardians where user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'С3: связи удалены');
select is((select status from parental_consents where parent_user_id = '00000000-0000-0000-0000-0000000000b2' and consent_type = 'data_processing'), 'revoked', 'С1: erase_parent записал отзыв');
select is((select count(*)::int from parental_consent_events where parent_user_id = '00000000-0000-0000-0000-0000000000b2'), 2, 'С3: история сохранена (принятие и отзыв)');
select is((select count(*)::int from users where id = '00000000-0000-0000-0000-0000000000b2'), 1, 'С3: пользователь не удалён');

select is((select count(*)::int from parental_consent_events a join parental_consent_events b on b.parent_user_id = a.parent_user_id and b.player_id = a.player_id and b.consent_type = a.consent_type and b.id > a.id and b.occurred_at < a.occurred_at), 0, 'П7а: время событий пары и типа не убывает по порядку записи');

-- Б: триггеры и блокировки на месте
select is((select count(*)::int from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('consent_versions_lock', 'consent_links_lock', 'consent_on_link_delete')), 3, 'Б1: три новых триггера включены');
select is((select position('advisory' in prosrc) from pg_proc where proname = 'consent_doc_versions_keep_open'), 0, 'Б3: проверка инварианта версий блокировку больше не берёт');

-- Н-B/Н-D (раунд 2): прямая запись истории и состояния в обход функций закрыта для ролей приложения, включая service_role.
-- Остаётся только у владельца базы (как и отключение триггеров); ловится db/ops/readonly-consent-invariants-238.sql.
reset role;
select is(has_table_privilege('service_role', 'parental_consent_events', 'insert'), false, 'Н-B: service_role не пишет историю напрямую');
select is(has_table_privilege('service_role', 'parental_consents', 'insert') or has_table_privilege('service_role', 'parental_consents', 'update'), false, 'Н-D: service_role не пишет состояние напрямую');
select is(has_table_privilege('service_role', 'parental_consent_events', 'select') and has_table_privilege('service_role', 'parental_consents', 'select'), true, 'service_role по-прежнему читает историю и состояние');
set local role service_role;
select throws_ok($$insert into parental_consent_events (parent_user_id, player_id, consent_type, version_id, event, source) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'media_publication', '00000000-0000-0000-0000-0000000f0002', 'revoked', 'admin')$$, '42501', null, 'Н-B: прямая вставка события от service_role отклонена');
reset role;

-- Н-C (раунд 2): таймаут блокировки вызывающего не меняется после вызова; более строгий не ослабляется.
set local lock_timeout = '200ms';
select as_user('00000000-0000-0000-0000-0000000000b1');
select revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'media_publication');
select is(current_setting('lock_timeout'), '200ms', 'Н-C: после вызова остаётся таймаут вызывающего (200ms)');
set local lock_timeout = 0;
select revoke_parent_consent('00000000-0000-0000-0000-00000000d001', 'media_publication');
select is(current_setting('lock_timeout'), '0', 'Н-C: после вызова таймаут снова 0, 5 с не остаются в транзакции');
reset role;

select * from finish();
rollback;
