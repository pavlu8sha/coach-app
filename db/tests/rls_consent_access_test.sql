-- pgTAP (#238, PR 2b, миграция 0173): доступ по новой модели согласий и режим consent.mode. Только синтетические данные.
-- Условия приёмки: docs/CONSENT_PR2B_ACCEPTANCE.md (Р, Д, М, Ф, С).
begin;
create extension if not exists pgtap;
select plan(79);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
-- режим ставит владелец базы (без JWT): вызывать после reset role
create function set_mode(m text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  delete from club_settings where club_id = tx(1) and key = 'consent.mode';
  if m is not null then insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', '', m); end if;
end $$;
create function acc(uid uuid, p uuid) returns boolean language plpgsql as $$
begin
  perform as_user(uid);
  return is_guardian_of(p);
end $$;

-- Клуб 1, группа 2, админ 10, тренер 11; родители 21-29; дети 31-36; детские аккаунты 41-44; версии 51-54.
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Группа');
insert into users (id, telegram_id, display_name, is_admin, club_id, chosen_role) values
  (tx(10), 7010, 'Админ', true, tx(1), null), (tx(11), 7011, 'Тренер', false, tx(1), null),
  (tx(21), 7021, 'Р21', false, tx(1), null), (tx(22), 7022, 'Р22', false, tx(1), null), (tx(23), 7023, 'Р23', false, tx(1), null),
  (tx(24), 7024, 'Р24', false, tx(1), null), (tx(25), 7025, 'Р25', false, tx(1), null), (tx(26), 7026, 'Р26', false, tx(1), null),
  (tx(27), 7027, 'Р27', false, tx(1), null), (tx(28), 7028, 'Р28', false, tx(1), null),
  (tx(41), 7041, 'Ребёнок-аккаунт 31', false, tx(1), 'child'), (tx(42), 7042, 'Ребёнок-аккаунт 32', false, tx(1), 'child'),
  (tx(43), 7043, 'Новый ребёнок 1', false, tx(1), 'child'), (tx(44), 7044, 'Новый ребёнок 2', false, tx(1), 'child');
insert into coach_groups (user_id, group_id) values (tx(11), tx(2));
insert into players (id, club_id, group_id, full_name) values
  (tx(31), tx(1), tx(2), 'Синтетик Альфа'), (tx(32), tx(1), tx(2), 'Синтетик Бета'), (tx(33), tx(1), tx(2), 'Синтетик Гамма'),
  (tx(34), tx(1), tx(2), 'Синтетик Дельта'), (tx(35), tx(1), tx(2), 'Синтетик Эпсилон'), (tx(36), tx(1), tx(2), 'Синтетик Зета');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  (tx(31), tx(21), 'lawyer-2026-11-v1', now()), (tx(31), tx(22), 'lawyer-2026-11-v1', now()),
  (tx(32), tx(23), 'lawyer-2026-11-v1', now()), (tx(34), tx(25), 'lawyer-2026-11-v1', now()),
  (tx(35), tx(26), 'lawyer-2026-11-v1', now()), (tx(35), tx(27), 'lawyer-2026-11-v1', now());
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  (tx(33), tx(24), 'lawyer-2026-11-v1', now() - interval '30 days', now() - interval '20 days'),
  (tx(36), tx(28), 'lawyer-2026-11-v1', now() - interval '30 days', now() - interval '20 days');
insert into child_links (user_id, player_id) values (tx(41), tx(31)), (tx(42), tx(32));
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values
  (tx(51), 'data_processing', 'syn-dp-0', now() - interval '20 days', true),
  (tx(53), 'media_publication', 'syn-mp-1', now() - interval '20 days', false);
insert into payments (player_id, amount, paid_on) values (tx(31), 10, current_date);
insert into first_wave_children (player_id, direction) values (tx(31), 'ind_sat'), (tx(32), 'ind_sat');

-- Р1: без ключа режим off
select is(consent_new_model_for(tx(21), tx(31)), false, 'Р1: нет ключа consent.mode — прежние правила');
select is(acc(tx(21), tx(31)), true, 'off: родитель со связью видит ребёнка (как сегодня)');
select is(acc(tx(24), tx(33)), false, 'off: старый отзыв закрывает доступ (как сегодня)');

-- Состояния новой модели
select as_user(tx(25)); select accept_consent(tx(34), 'data_processing', tx(51));   -- примет версию 0, она устареет
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values
  (tx(52), 'data_processing', 'syn-dp-1', now() - interval '10 days', true);
select as_user(tx(21)); select accept_consent(tx(31), 'data_processing', tx(52));
select as_user(tx(22)); select accept_consent(tx(31), 'media_publication', tx(53));   -- только публикационное
select as_user(tx(23)); select accept_consent(tx(32), 'data_processing', tx(52));
select as_user(tx(24)); select accept_consent(tx(33), 'data_processing', tx(52));     -- после старого отзыва
select as_user(tx(26)); select accept_consent(tx(35), 'data_processing', tx(52));
select revoke_parent_consent(tx(35), 'data_processing');                              -- новый отзыв родителем
select as_user(tx(27)); select accept_consent(tx(35), 'data_processing', tx(52));
reset role;
-- системный отзыв: связь удалена и создана заново владельцем
delete from player_guardians where player_id = tx(32) and user_id = tx(23);
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values (tx(32), tx(23), 'lawyer-2026-11-v1', now());

-- Д1-Д4 при off
select is(acc(tx(22), tx(31)), true, 'Д4 off: публикационное согласие на доступ не влияет');
select is(acc(tx(23), tx(32)), true, 'Д1 off: системный отзыв (удаление связи) доступ не закрывает');
select is(acc(tx(26), tx(35)), false, 'Д2 off: новый отзыв родителем закрывает доступ');
select is(acc(tx(27), tx(35)), true, 'off: второй родитель того же ребёнка доступ сохраняет');
select is(acc(tx(24), tx(33)), false, 'off: старый отзыв по-прежнему закрывает доступ, даже после принятия по новой модели');
select as_user(tx(26));
select is(is_any_guardian(), false, 'off: is_any_guardian ложен после нового отзыва');
select as_user(tx(24));
select ok(exists (select 1 from search_players_for_link('Синтетик Гамма') s where s.player_id = tx(33)), 'off: ребёнок со старым отзывом снова находится в поиске (как сегодня)');

-- Режим all (регистр и пробелы не важны)
reset role; select set_mode(' ALL ');
select is(consent_new_model_for(tx(21), tx(31)), true, 'Р1: значение « ALL » включает новую модель');
select is(acc(tx(21), tx(31)), true, 'М1 all: родитель с согласием видит ребёнка');
select is(acc(tx(22), tx(31)), false, 'М1 all: второй родитель без своего согласия не видит');
select is(acc(tx(23), tx(32)), false, 'С5/all: после удаления и пересоздания связи нужно принять заново');
select is(acc(tx(24), tx(33)), true, 'Д3 all: старый отзыв не мешает после принятия');
select is(acc(tx(25), tx(34)), false, 'М4 all: принята устаревшая версия — доступа нет');
select is(acc(tx(26), tx(35)), false, 'Д2 all: новый отзыв закрывает доступ');
select is(acc(tx(27), tx(35)), true, 'М1 all: родитель, не отзывавший, видит ребёнка');
select as_user(tx(22));
select is((select count(*)::int from players where id = tx(31)), 0, 'М1 all: политика players не показывает ребёнка без личного согласия');
select is(is_any_guardian(), false, 'all: is_any_guardian ложен без согласия');
select is(is_guardian_in_group(tx(2)), false, 'all: группа не видна родителю без согласия');
select as_user(tx(21));
select is((select count(*)::int from players where id = tx(31)), 1, 'М1 all: политика players показывает ребёнка при согласии');
select is(is_guardian_in_group(tx(2)), true, 'all: группа видна родителю с согласием');
select as_user(tx(41));
select is(is_self_player(tx(31)), true, 'М2 all: детский аккаунт открыт, если согласие есть хотя бы у одного родителя');
select is(is_guardian_in_group(tx(2)), true, 'М2 all: детскому аккаунту видна группа');
select as_user(tx(42));
select is(is_self_player(tx(32)), false, 'М2 all: детский аккаунт закрыт, если согласия нет ни у одного родителя');
select is(is_guardian_in_group(tx(2)), false, 'М2 all: группа детскому аккаунту без согласий не видна');

-- М3: контакты тренеру
select as_user(tx(11));
select is((select string_agg(parent_name, ',' order by parent_name) from group_parents(tx(2))), 'Р21,Р24,Р27', 'М3 all: тренеру видны только родители с личным согласием');

-- М2: вход по коду ребёнка
reset role;
insert into child_codes (code, player_id, created_by) values ('SYNK32', tx(32), tx(23)), ('SYNK35', tx(35), tx(27));
select as_user(tx(43));
select is(redeem_child_code('SYNK32'), null, 'М2 all: код ребёнка без согласий родителей не срабатывает');
select as_user(tx(44));
select is(redeem_child_code('SYNK35'), tx(35), 'М2 all: код ребёнка срабатывает при согласии одного из родителей');

-- Ф1: получатели сообщений
reset role;
select enqueue_to_guardians(tx(31), 'syn_test', 'проверка');
select is((select count(*)::int from notifications where kind = 'syn_test' and user_id = tx(21)), 1, 'Ф1 all: сообщение о ребёнке получает родитель с согласием');
select is((select count(*)::int from notifications where kind = 'syn_test' and user_id = tx(22)), 0, 'Ф1 all: родитель без согласия сообщение не получает');

-- Ф4: поиск
select as_user(tx(24));
select ok(not exists (select 1 from search_players_for_link('Синтетик Гамма') s where s.player_id = tx(33)), 'Ф4 all: ребёнок с существующей связью в поиск не попадает');
select as_user(tx(22));
select ok(not exists (select 1 from search_players_for_link('Синтетик Альфа') s where s.player_id = tx(31)), 'Ф4 all: ожидающий согласия родитель не видит своего ребёнка в поиске');

-- Ф5: первая волна
select as_user(tx(10));
select is((select consent_missing from first_wave_list() where player_id = tx(32)), true, 'Ф5 all: в списке первой волны отмечен ребёнок без согласия');
select is((select consent_missing from first_wave_list() where player_id = tx(31)), false, 'Ф5 all: ребёнок с согласием без отметки');
select is((select count(*)::int from first_wave_list()), 2, 'Ф5: администратор видит всех детей списка');
select lives_ok($$select first_wave_add(array['ind_sun'], array[tx(31), tx(32)])$$, 'Ф5: администратор добавляет в первую волну');
reset role;
select is((select string_agg(np.user_id::text, ',' order by np.user_id) from notification_prefs np where np.direction = 'ind_sun'), tx(21)::text, 'Ф5 all: направление включено только родителю с согласием');
select as_user(tx(21));
select throws_ok($$select * from first_wave_list()$$, '42501', null, 'Ф5: родителю список первой волны недоступен');
select as_user(tx(11));
select throws_ok($$select * from first_wave_list()$$, '42501', null, 'Ф5: тренеру список первой волны недоступен');

-- Ф6: выгрузка данных
select as_user(tx(21));
select is(jsonb_array_length(export_my_data() -> 'payments'), 1, 'Ф6 all: выгрузка оплат ребёнка при согласии');
select as_user(tx(22));
select is(jsonb_array_length(export_my_data() -> 'payments'), 0, 'Ф6 all: без согласия оплаты ребёнка не выгружаются');
select is(jsonb_array_length(export_my_data() -> 'children'), 1, 'Ф6: блок children (история связей) остаётся');

-- Ф2: старая кнопка отзыва на новой модели
select as_user(tx(27));
select lives_ok($$select revoke_consent(tx(35))$$, 'Ф2 all: старая кнопка отзыва работает');
reset role;
select is((select consent_revoked_at from player_guardians where player_id = tx(35) and user_id = tx(27)), null, 'Ф2 all: старое поле не записывается');
select is((select status from parental_consents where parent_user_id = tx(27) and player_id = tx(35) and consent_type = 'data_processing'), 'revoked', 'Ф2 all: отозвано согласие новой модели');
select is(acc(tx(27), tx(35)), false, 'Ф2 all: после отзыва доступа нет');

-- Ф3: повторное одобрение существующей связи
reset role;
insert into link_requests (id, user_id, player_id, status) values (tx(61), tx(24), tx(33), 'pending');
select as_user(tx(10));
select lives_ok($$select decide_link(tx(61), true)$$, 'Ф3 all: администратор одобряет запрос по существующей связи');
reset role;
select isnt((select consent_revoked_at from player_guardians where player_id = tx(33) and user_id = tx(24)), null, 'Ф3 all: прежние поля существующей связи не тронуты');

-- Р2: режим test
reset role; select set_mode('test');
insert into consent_test_parents (parent_user_id) values (tx(22));
select is(consent_new_model_for(tx(22), tx(31)), true, 'Р2 test: родитель из списка на новой модели');
select is(consent_new_model_for(tx(21), tx(31)), false, 'Р2 test: родитель вне списка на прежних правилах');
select is(acc(tx(22), tx(31)), false, 'Р2 test: родитель из списка без согласия не видит');
select is(acc(tx(23), tx(32)), true, 'Р2 test: родитель вне списка — как сегодня');
select is(acc(tx(24), tx(33)), false, 'Р2 test: старый отзыв вне списка закрывает доступ');
select is(acc(tx(26), tx(35)), false, 'Д2 test: новый отзыв закрывает доступ и вне списка');
reset role;
insert into consent_test_parents (parent_user_id) values (tx(24));
select is(acc(tx(24), tx(33)), true, 'Р2 test: тот же родитель в списке — по новой модели');

-- Д2: откат режима
reset role; select set_mode('off');
select is(acc(tx(26), tx(35)), false, 'Д2: откат в off не возвращает доступ после нового отзыва');
select is(acc(tx(27), tx(35)), false, 'Д2: откат в off не возвращает доступ после отзыва старой кнопкой на новой модели');
select is(acc(tx(22), tx(31)), true, 'Р1 off: значение off — прежние правила');

-- Ф2, Ф3 при off
reset role;
insert into link_requests (id, user_id, player_id, status) values (tx(62), tx(28), tx(36), 'pending');
select as_user(tx(10));
select lives_ok($$select decide_link(tx(62), true)$$, 'Ф3 off: одобрение существующей связи');
reset role;
select is((select consent_revoked_at from player_guardians where player_id = tx(36) and user_id = tx(28)), null, 'Ф3 off: как сегодня, старый отзыв снимается');
select as_user(tx(21));
select lives_ok($$select revoke_consent(tx(31))$$, 'Ф2 off: старая кнопка отзыва');
reset role;
select isnt((select consent_revoked_at from player_guardians where player_id = tx(31) and user_id = tx(21)), null, 'Ф2 off: старое поле записано, как сегодня');
select is((select status from parental_consents where parent_user_id = tx(21) and player_id = tx(31) and consent_type = 'data_processing'), 'revoked', 'Ф2 off: принятое согласие новой модели тоже отозвано');

-- Р3: защита режима и списка
select as_user(tx(10));
select throws_ok($$insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', '', 'all')$$, '42501', null, 'Р3: администратор не включает режим из приложения');
select throws_ok($$update club_settings set value = 'all' where key = 'consent.mode'$$, '42501', null, 'Р3: администратор не меняет режим из приложения');
select throws_ok($$delete from club_settings where key = 'consent.mode'$$, '42501', null, 'Р3: администратор не удаляет режим из приложения');
select lives_ok($$insert into club_settings (club_id, key, scope, value) values (tx(1), 'syn.other', '', '1')$$, 'Р3: другие настройки администратор меняет как раньше');
select throws_ok($$select * from consent_test_parents$$, '42501', null, 'Р3: список тестовых родителей недоступен из приложения');
reset role;
select set_config('role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', 'x', 'all')$$, '42501', null, 'Р3: service_role не включает режим');
select throws_ok($$insert into consent_test_parents (parent_user_id) values (tx(21))$$, '42501', null, 'Р3: service_role не меняет список тестовых родителей');
reset role;

-- Д5: права
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('parent_access_ok', 'consent_new_model_for', 'consent_mode_guard')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
                 or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))), 0, 'Д5: внутренние функции недоступны ролям приложения и PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('parent_access_ok', 'consent_new_model_for', 'consent_mode_guard')), 3, 'Д5: три внутренние функции на месте');

-- Ф7 и М3: флаг контактов
select throws_ok($$update consent_doc_versions set coach_contacts = false where id = tx(52)$$, '42501', null, 'Ф7: флаг контактов нельзя менять после подтверждения');
select set_mode('all');
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values (tx(54), 'data_processing', 'syn-dp-2', now() - interval '1 day', false);
select as_user(tx(24)); select accept_consent(tx(33), 'data_processing', tx(54));
select is(is_guardian_of(tx(33)), true, 'М3: родитель с согласием версии без контактов видит ребёнка');
select as_user(tx(11));
select ok(not exists (select 1 from group_parents(tx(2)) where parent_name = 'Р24'), 'М3: версия без разрешения контактов не раскрывает телеграм тренеру');
reset role;

-- С1: страж старого поля
select is((select coalesce(string_agg(x, ', ' order by x), '') from (
    select 'function ' || p.proname as x from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosrc like '%consent_revoked_at%'
       and p.proname not in ('parent_access_ok', 'decide_link', 'revoke_consent', 'export_my_data')
    union all select 'policy ' || tablename || '.' || policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%consent_revoked_at%'
    union all select 'view ' || viewname from pg_views where schemaname = 'public' and definition like '%consent_revoked_at%' and viewname <> 'parental_consent_status'
    union all select 'matview ' || matviewname from pg_matviews where definition like '%consent_revoked_at%'
    union all select 'index ' || indexname from pg_indexes where indexdef like '%consent_revoked_at%'
    union all select 'constraint ' || conname from pg_constraint where pg_get_constraintdef(oid) like '%consent_revoked_at%'
    union all select 'default ' || adrelid::regclass::text from pg_attrdef where pg_get_expr(adbin, adrelid) like '%consent_revoked_at%'
    union all select 'trigger ' || tgname from pg_trigger where not tgisinternal and pg_get_triggerdef(oid) like '%consent_revoked_at%') s), '',
  'С1: consent_revoked_at только в белом списке');
select is((select position('consent_revoked_at is null' in prosrc) from pg_proc where proname = 'export_my_data'), 0, 'С1: в выгрузке доступ определяет предикат, старое поле только в истории');

select * from finish();
rollback;
