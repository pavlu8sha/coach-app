-- pgTAP (#238, PR 2c, миграция 0176): проверка согласия родителя при выдаче уведомления из очереди (claim_notifications).
-- Только синтетические данные, реальных отправок нет. Условия приёмки: docs/CONSENT_PR2C_ACCEPTANCE.md (У1-У18).
begin;
create extension if not exists pgtap;
select plan(66);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
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
create function set_mode(m text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  delete from club_settings where club_id = tx(1) and key = 'consent.mode';
  if m is not null then insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', '', m); end if;
end $$;
-- очередь: добавить строку напрямую (владелец базы), метка в тексте
create function q(u uuid, lbl text, pls uuid[]) returns void language sql as $$
  insert into notifications (user_id, kind, text, player_ids) values (u, 'syn', lbl, pls)
$$;
-- claim как служебная роль: метки вида «текст:telegram_id», отсортированные
create function cl() returns text[] language plpgsql as $$
declare r text[];
begin
  perform as_service();
  select coalesce(array_agg(c.text || ':' || c.telegram_id order by c.text, c.telegram_id), '{}') into r from claim_notifications(50) c;
  reset role;
  return r;
end $$;
create function st(lbl text) returns text language sql as $$
  select string_agg(state, ',' order by user_id) from notifications where text = lbl
$$;
create function err(lbl text) returns text language sql as $$
  select string_agg(coalesce(last_error, '-'), ',' order by user_id) from notifications where text = lbl
$$;
create function accept(uid uuid, p uuid) returns void language plpgsql as $$
begin
  perform as_user(uid);
  perform accept_consent(p, 'data_processing', tx(51));
  reset role;
end $$;
create function revoke_(uid uuid, p uuid) returns void language plpgsql as $$
begin
  perform as_user(uid);
  perform revoke_parent_consent(p, 'data_processing');
  reset role;
end $$;
create function bid(k text) returns uuid language sql security definer as $$ select id from camp_broadcasts where kind = k $$;
grant execute on function bid(text) to public;
create temp table _pao as select pg_get_functiondef('parent_access_ok(uuid,uuid)'::regprocedure) as d;
grant all on _pao to public;

-- Клуб 1, админ 10, родители 21-26 (telegram 7021-7026), дети 31-36, группа 2.
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Группа');
insert into users (id, telegram_id, display_name, is_admin, club_id, chosen_role) values
  (tx(10), 7010, 'Админ', true, tx(1), null),
  (tx(21), 7021, 'Р21', false, tx(1), null), (tx(22), 7022, 'Р22', false, tx(1), null), (tx(23), 7023, 'Р23', false, tx(1), null),
  (tx(24), 7024, 'Р24', false, tx(1), null), (tx(25), 7025, 'Р25', false, tx(1), null), (tx(26), 7026, 'Р26', false, tx(1), null);
insert into players (id, club_id, group_id, full_name) values
  (tx(31), tx(1), tx(2), 'Синтетик Альфа'), (tx(32), tx(1), tx(2), 'Синтетик Бета'), (tx(33), tx(1), tx(2), 'Синтетик Гамма'),
  (tx(34), tx(1), tx(2), 'Синтетик Дельта'), (tx(35), tx(1), tx(2), 'Синтетик Эпсилон');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  (tx(31), tx(21), 'lawyer-2026-11-v1', now()), (tx(31), tx(22), 'lawyer-2026-11-v1', now()),
  (tx(32), tx(23), 'lawyer-2026-11-v1', now()), (tx(33), tx(23), 'lawyer-2026-11-v1', now()),
  (tx(34), tx(24), 'lawyer-2026-11-v1', now()), (tx(35), tx(25), 'lawyer-2026-11-v1', now()),
  (tx(35), tx(26), 'lawyer-2026-11-v1', now());
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values
  (tx(51), 'data_processing', 'syn-dp-1', now() - interval '10 days', true);
select set_mode('all');
select accept(tx(21), tx(31)); select accept(tx(22), tx(31)); select accept(tx(23), tx(32)); select accept(tx(23), tx(33));
select accept(tx(24), tx(34));
-- родители 25 и 26 согласия по новой модели не принимали

-- ===== У8 постановка записывает детей получателя =====
select enqueue_to_guardians(tx(31), 'syn_pls', 'T0');
select is((select count(*)::int from notifications where kind = 'syn_pls' and player_ids = array[tx(31)]), 2, 'У8: enqueue_to_guardians сохраняет ребёнка в player_ids обоим родителям');
select enqueue_to_guardians(tx(35), 'syn_pls2', 'T0b');
select is((select count(*)::int from notifications where kind = 'syn_pls2'), 0, 'У8/сценарий 3: нет согласия до постановки — сообщение не создаётся');
delete from notifications;

-- ===== У1 действующее согласие: адресное уходит =====
select enqueue_to_guardians(tx(31), 'syn', 'L1');
select is(cl(), array['L1:7021', 'L1:7022'], 'У1: адресное сообщение при согласии выдаётся обоим родителям');
select is(st('L1'), 'pending,pending', 'У1: выданные строки остаются pending до finish_notification (состояние отправки ведёт tg-notify)');
delete from notifications;

-- ===== У2 нет согласия: подавляется =====
select q(tx(25), 'L2', array[tx(35)]);
select is(cl(), '{}'::text[], 'У2: адресное без действующего согласия не выдаётся');
select is(st('L2') || '|' || err('L2'), 'skipped|consent', 'У2: состояние skipped, причина consent');
select is((select attempts from notifications where text = 'L2'), 0, 'У2: подавленная строка не считается попыткой отправки');
delete from notifications;

-- ===== У3 отзыв после постановки, до claim =====
select enqueue_to_guardians(tx(34), 'syn', 'L3');
select revoke_(tx(24), tx(34));
select is(cl(), '{}'::text[], 'У3: отзыв после постановки до claim подавляет сообщение');
select is(st('L3') || '|' || err('L3'), 'skipped|consent', 'У3: skipped, причина consent');
-- восстановление согласия: подавленное не возвращается
select accept(tx(24), tx(34));
select is(cl(), '{}'::text[], 'У3/13: после восстановления согласия подавленное сообщение не отправляется задним числом');
select is(st('L3'), 'skipped', 'У3/13: строка остаётся skipped');
-- новое сообщение после восстановления доставляется
select enqueue_to_guardians(tx(34), 'syn', 'L3b');
select is(cl(), array['L3b:7024'], 'У3: новое сообщение после восстановления согласия выдаётся');
delete from notifications;

-- ===== Отзыв до постановки (У8) =====
select revoke_(tx(24), tx(34));
select enqueue_to_guardians(tx(34), 'syn', 'L4');
select is((select count(*)::int from notifications where text = 'L4'), 0, 'сценарий 3: отзыв до постановки — строка не создаётся');
select accept(tx(24), tx(34));
delete from notifications;

-- ===== У4 повторная попытка не обходит проверку =====
select enqueue_to_guardians(tx(31), 'syn', 'L5');
select is(cl(), array['L5:7021', 'L5:7022'], 'У4: первая выдача проходит');
update notifications set claimed_at = now() - interval '3 minutes' where text = 'L5';
select revoke_(tx(22), tx(31));
select is(cl(), array['L5:7021'], 'У4: повторный claim после истечения закрепления не выдаёт строку родителя, отозвавшего согласие');
select is(st('L5'), 'pending,skipped', 'У4: у второго родителя skipped');
select accept(tx(22), tx(31));
delete from notifications;

-- ===== У9 два родителя одного ребёнка проверяются независимо =====
select enqueue_to_guardians(tx(31), 'syn', 'L6');
select revoke_(tx(21), tx(31));
select is(cl(), array['L6:7022'], 'У9: отзыв первого родителя не подавляет сообщение второго');
select accept(tx(21), tx(31));
delete from notifications;

-- ===== У7 несколько детей: подавление целиком =====
select q(tx(23), 'M1', array[tx(32), tx(33)]);
select revoke_(tx(23), tx(33));
select is(cl(), '{}'::text[], 'У7: согласия нет по одному из двух детей — сообщение подавляется целиком');
select is(st('M1'), 'skipped', 'У7: skipped');
select accept(tx(23), tx(33));
select q(tx(23), 'M2', array[tx(32), tx(33)]);
select is(cl(), array['M2:7023'], 'У7: согласие есть по обоим детям — сообщение выдаётся');
select is(st('M1'), 'skipped', 'У7/13: прежнее подавленное сообщение остаётся skipped');
delete from notifications;

-- ===== У5/У18 общие сообщения и старые строки =====
select revoke_(tx(24), tx(34));
select q(tx(24), 'G1', null);
select is(cl(), array['G1:7024'], 'У5/У18: общее сообщение (player_ids null) выдаётся независимо от отзыва по ребёнку');
delete from notifications;

-- ===== У10 смешанная пачка одному родителю =====
select q(tx(24), 'A1', array[tx(34)]);
select q(tx(24), 'G2', null);
select is(cl(), array['G2:7024'], 'У10: в одной пачке общее выдаётся, адресное подавляется');
select is(st('A1') || '|' || st('G2'), 'skipped|pending', 'У10: состояния по строкам независимы');
select accept(tx(24), tx(34));
delete from notifications;

-- ===== Исключения: админам, тренерам, link_decided, data_request_done остаются общими =====
select enqueue_notification(tx(24), 'link_decided', 'LD');
select enqueue_notification(tx(24), 'data_request_done', 'DR');
select is((select count(*)::int from notifications where kind in ('link_decided', 'data_request_done') and player_ids is null), 2, 'исключения: link_decided и data_request_done ставятся без player_ids');
select revoke_(tx(24), tx(34));
select is(cl(), array['DR:7024', 'LD:7024'], 'исключения: не подавляются по модели согласий');
select accept(tx(24), tx(34));
delete from notifications;
select enqueue_to_admins('syn_admin', 'ADM');
select is(cl(), array['ADM:7010'], 'исключения: администратору сообщение выдаётся');
delete from notifications;

-- ===== У6 режимы off / test / all =====
-- off: условие прежнее (consent_revoked_at), согласий по новой модели у 25 нет, связь не отозвана
select set_mode(null);
select q(tx(25), 'O1', array[tx(35)]);
select is(cl(), array['O1:7025'], 'У6 off: связь без старого отзыва — адресное выдаётся без согласия по новой модели');
update player_guardians set consent_revoked_at = now() where user_id = tx(25) and player_id = tx(35);
select q(tx(25), 'O2', array[tx(35)]);
select is(cl(), '{}'::text[], 'У6 off: старый отзыв consent_revoked_at после постановки подавляет сообщение');
select is(st('O2'), 'skipped', 'У6 off: skipped');
update player_guardians set consent_revoked_at = null where user_id = tx(25) and player_id = tx(35);
delete from notifications;
-- test: родитель в списке на новой модели, остальные по прежним правилам
select set_mode('test');
insert into consent_test_parents (parent_user_id) values (tx(25));
select q(tx(25), 'T1', array[tx(35)]);
select q(tx(26), 'T2', array[tx(35)]);
select is(cl(), array['T2:7026'], 'У6 test: родитель из списка без согласия подавлен, родитель вне списка — по прежним правилам');
delete from notifications;
-- all
select set_mode('all');
select q(tx(26), 'AL1', array[tx(35)]);
select q(tx(21), 'AL2', array[tx(31)]);
select is(cl(), array['AL2:7021'], 'У6 all: только родитель с согласием по новой модели');
delete from notifications;
delete from consent_test_parents;

-- ===== У7/У11 ошибка проверки: fail-closed, три ошибки — failed =====
create or replace function parent_access_ok(parent uuid, player uuid) returns boolean language plpgsql as $$ begin raise exception 'synthetic check failure'; end $$;
select q(tx(21), 'E1', array[tx(31)]);
select q(tx(22), 'EG', null);
select is(cl(), array['EG:7022'], 'У7: при ошибке проверки адресная строка не выдаётся, общая в той же пачке выдаётся');
select is(st('E1') || '|' || err('E1') || '|' || (select consent_check_attempts from notifications where text = 'E1') || '|' || (select attempts from notifications where text = 'E1'), 'pending|consent_check_error|1|0', 'У7: ошибка считается в consent_check_attempts, не в attempts');
select is(cl(), '{}'::text[], 'У7: вторая ошибка — снова не выдаётся');
select is(cl(), '{}'::text[], 'У7: третья ошибка — не выдаётся');
select is(st('E1') || '|' || err('E1') || '|' || (select consent_check_attempts from notifications where text = 'E1'), 'failed|consent_check_error|3', 'У7: после трёх ошибок failed с причиной consent_check_error');
select is(cl(), '{}'::text[], 'У7: failed не возвращается в очередь');
select lives_ok((select d from _pao), 'предикат восстановлен');
delete from notifications;
select is(cl(), '{}'::text[], 'предикат восстановлен: очередь пуста');
select q(tx(21), 'E2', array[tx(31)]);
select is(cl(), array['E2:7021'], 'после восстановления предиката проверка снова проходит');
delete from notifications;
-- пустой список детей: не выдаётся
select q(tx(21), 'EMPTY', '{}'::uuid[]);
select is(cl(), '{}'::text[], 'пустой player_ids трактуется как нет подтверждения (fail-closed)');
delete from notifications;

-- ===== Структура, права, совместимость =====
select is(pg_get_function_result('claim_notifications(integer)'::regprocedure), 'TABLE(id uuid, telegram_id bigint, text text, buttons jsonb, claim_token uuid)', 'У14: возвращаемые поля claim_notifications прежние; 0184 добавила последним полем claim_token');
select is(has_function_privilege('service_role', 'claim_notifications(integer)', 'execute'), true, 'У14: service_role выполняет claim_notifications');
select is(has_function_privilege('authenticated', 'claim_notifications(integer)', 'execute') or has_function_privilege('anon', 'claim_notifications(integer)', 'execute'), false, 'У14: authenticated и anon не выполняют claim_notifications');
select is(has_function_privilege('authenticated', 'enqueue_notification(uuid,text,text,uuid[])', 'execute') or has_function_privilege('anon', 'enqueue_direction_notification(uuid,text,text,text,uuid[])', 'execute') or has_function_privilege('authenticated', 'camp_broadcast_player_ids(uuid,uuid)', 'execute'), false, 'У14: новые служебные функции закрыты');
select is(has_column_privilege('authenticated', 'notifications', 'player_ids', 'select') or has_column_privilege('anon', 'notifications', 'consent_check_attempts', 'select'), false, 'У14: новые столбцы очереди недоступны клиентам');
select throws_ok($$insert into notifications (user_id, kind, text, state) values ('00000000-0000-0000-0000-000000000015', 'x', 'y', 'bogus')$$, '23514', null, 'допустимые состояния проверяются (check)');
select lives_ok($$insert into notifications (user_id, kind, text, state) values ('00000000-0000-0000-0000-000000000015', 'x', 'y', 'skipped')$$, 'У12: состояние skipped допустимо');
delete from notifications;
select as_user(tx(21));
select throws_ok($$select * from claim_notifications(5)$$, '42501', null, 'У14: родитель не вызывает claim_notifications');
reset role;

-- ===== Старые строки без player_ids (У18): состояние pending до миграции и общие остаются общими =====
select q(tx(25), 'OLD', null);
select is(cl(), array['OLD:7025'], 'У18: строка без player_ids выдаётся без проверки, даже при отсутствии согласия');
delete from notifications;

-- ===== У15 порядок и лимит: рассылки после обычных, пачка не больше 50 =====
insert into notifications (user_id, kind, text) select tx(21), 'syn', 'B' || lpad(g::text, 3, '0') from generate_series(1, 60) g;
select is(array_length(cl(), 1), 50, 'У15: пачка не больше 50');
delete from notifications;

-- ===== У11/У12 рассылки сборов: журнал и лимиты =====
insert into camps (id, club_id, name, location, starts_on, ends_on, full_payment_deadline) values
  (tx(61), tx(1), 'Синтетический сбор', 'Исани', '2099-01-03', '2099-01-10', '2098-12-20');
insert into camp_tariffs (id, camp_id, name, price, active) values (tx(62), tx(61), 'Тариф', 1000, true);
insert into club_settings (club_id, key, value, scope) values (tx(1), 'camps.notify', 'on', '');
select as_user(tx(21)); select camp_parent_register(tx(61), tx(31), tx(62), null);
select as_user(tx(23)); select camp_parent_register(tx(61), tx(32), tx(62), null);
select camp_parent_register(tx(61), tx(33), tx(62), null);
reset role;
delete from notifications;
create function bsend(k text, b text, n int) returns jsonb language plpgsql as $$
begin
  return camp_broadcast_send(tx(61), k, b, n, camp_broadcast_preview(tx(61), k, b)->>'token');
end $$;
select as_user(tx(10));
select is((bsend('reminder', null, 3))->>'recipients', '3', 'рассылка-напоминание ушла в очередь родителям должников (21, 22 и 23)');
reset role;
select is((select player_ids from notifications where user_id = tx(21) and kind = 'camp_broadcast_reminder'), array[tx(31)], 'camp_broadcast_reminder: дети получателя в player_ids');
select is((select array_length(player_ids, 1) from notifications where user_id = tx(23) and kind = 'camp_broadcast_reminder'), 2, 'camp_broadcast_reminder: оба ребёнка семьи в player_ids');
select as_user(tx(10));
select is((bsend('info', 'Выезд в 9:00', 4))->>'recipients', '4', 'информационная рассылка ушла в очередь (родители с согласием 21-24)');
reset role;
select is((select count(*)::int from notifications where kind = 'camp_broadcast_info' and player_ids is not null), 0, 'camp_broadcast_info общее: player_ids null');
select revoke_(tx(23), tx(33));
select cl();
select is((select count(*)::int from notifications where kind = 'camp_broadcast_info' and attempts = 1), 4,
  'общая информационная рассылка выдана всем четырём, в том числе родителю с отзывом по одному ребёнку');
select is((select count(*)::int from notifications where kind = 'camp_broadcast_reminder' and attempts = 1), 2, 'адресные напоминания выданы родителям без отзыва');
select is((select state from notifications where user_id = tx(23) and kind = 'camp_broadcast_reminder'), 'skipped', 'напоминание об оплате с именами детей подавлено целиком при отзыве по одному ребёнку');
select as_user(tx(10));
select is((select pending || '|' || sent || '|' || failed || '|' || skipped || '|' || cleared || '|' || recipients from camp_broadcast_list(tx(61)) where kind = 'reminder'), '2|0|0|1|0|3', 'У12: журнал напоминания: skipped учтён, сумма колонок равна числу получателей');
select is((select pending + sent + failed + skipped + cleared = recipients from camp_broadcast_list(tx(61)) where kind = 'info'), true, 'У12: для информационной рассылки сумма колонок тоже сходится');
select is((select count(*)::int from camp_broadcast_recipients(bid('reminder')) where state = 'skipped'), 1, 'У12: результат по получателям показывает состояние skipped');
reset role;
-- У11: подавленные строки считаются в дневных лимитах; слоты журналов не освобождаются
insert into notifications (user_id, kind, text, state, last_error, player_ids) values
  (tx(21), 'camp_broadcast_info', 'S1', 'skipped', 'consent', array[tx(31)]), (tx(21), 'camp_broadcast_info', 'S2', 'skipped', 'consent', array[tx(31)]);
select is((select count(*)::int from notifications n where n.user_id = tx(21) and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day'), 4, 'У11: подавленные строки входят в дневной счётчик рассылок (reminder, info и две skipped)');
insert into booking_notice_log (kind, ref_id, user_id) values ('syn_slot', tx(70), tx(21));
select q(tx(21), 'SLOT', array[tx(31)]);
select revoke_(tx(21), tx(31));
select is(cl() @> array['SLOT:7021'], false, 'У11: сообщение подавлено');
select is((select count(*)::int from booking_notice_log where kind = 'syn_slot' and user_id = tx(21)), 1, 'У11: слот booking_notice_log при подавлении не освобождается');
select accept(tx(21), tx(31));

select * from finish();
rollback;
