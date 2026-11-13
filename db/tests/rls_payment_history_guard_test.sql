-- pgTAP: история платежей не стирается каскадом и не переписывается молча (DATA-01, миграция 0179, docs/PAYMENT_HISTORY_ACCEPTANCE.md).
-- Условия У1–У8, У12, У13 проверяются здесь; У9–У11 проверяют preflight, откат и полный прогон.
begin;
create extension if not exists pgtap;
select plan(50);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9911, 'Админ', true);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 'С платежом', 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', 'Без записей', 'active'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c001', 'Платёж матча', 'active'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000c001', 'Платёж турнира', 'active'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000c001', 'Закрытый месяц', 'active'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-00000000c001', 'Открытый месяц', 'active'),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-00000000c001', 'Неоплаченный взнос матча', 'active'),
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-00000000c001', 'Долг за матч', 'active'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-00000000c001', 'Долг за турнир', 'active');

insert into payments (id, player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 100, '2026-10-05', 'Наличные');
insert into service_payments (kind, ref_id, player_id, amount, paid_on, method) values
  ('equipment', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000f1', 50, '2026-10-05', 'Наличные');

insert into matches (id, club_id, played_on, team, opponent, kind) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000c001', '2026-10-30', 'U9', 'Звезда', 'friendly');
insert into match_fees (match_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f3', 25),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7', 25),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f8', 25);
insert into matches (id, club_id, played_on, team, opponent, kind) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000c001', '2026-10-31', 'U9', 'Отменённый', 'friendly');
insert into match_fees (match_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f8', 25);
insert into match_payments (id, match_id, player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f3', 25, '2026-10-30', 'Наличные');

insert into tournaments (id, club_id, team, kind, name, fee) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 200);
insert into tournament_fees (tournament_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000f4', 200),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000f9', 200);
insert into tournament_payments (id, tournament_id, player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000f4', 200, '2026-10-20', 'Наличные');

insert into subscriptions (player_id, month, discount, closed_kind, closed_reason) values
  ('00000000-0000-0000-0000-0000000000f5', '2026-10-01', true, 'discount', 'тестовая скидка');
insert into subscriptions (player_id, month) values
  ('00000000-0000-0000-0000-0000000000f6', '2026-10-01');

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
grant execute on function as_user(uuid), as_service() to public;

-- Триггеры платежей: прямые запросы, все роли (владелец в обычной сессии, администратор, service_role)
select throws_ok($$delete from payments where id = '00000000-0000-0000-0000-0000000000b1'$$, 'P0001', null, 'У1: владелец не удаляет платёж (payments)');
select is((select count(*)::int from payments where id = '00000000-0000-0000-0000-0000000000b1'), 1, 'У1: платёж остаётся после отказа');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$delete from match_payments where id = '00000000-0000-0000-0000-0000000000e1'$$, 'P0001', null, 'У1: администратор не удаляет платёж матча');
select as_service();
select throws_ok($$delete from tournament_payments where id = '00000000-0000-0000-0000-0000000000e2'$$, 'P0001', null, 'У1: service_role не удаляет платёж турнира');
reset role;
select throws_ok($$delete from service_payments where player_id = '00000000-0000-0000-0000-0000000000f1'$$, 'P0001', null, 'У1: платёж сбора/услуги не удаляется');
select throws_ok($$truncate payments$$, 'P0001', null, 'У3: TRUNCATE payments отклоняется');
select throws_ok($$truncate match_payments$$, 'P0001', null, 'У3: TRUNCATE match_payments отклоняется');
select throws_ok($$update payments set amount = 1 where id = '00000000-0000-0000-0000-0000000000b1'$$, 'P0001', null, 'У4: сумма платежа не меняется');
select throws_ok($$update payments set player_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'P0001', null, 'У4: игрок платежа не меняется');
select throws_ok($$update match_payments set amount = 1 where id = '00000000-0000-0000-0000-0000000000e1'$$, 'P0001', null, 'У4: сумма платежа матча не меняется');
select lives_ok($$update payments set paid_on = '2026-10-06' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'У4: дата платежа исправляется');
select is((select count(*)::int from audit_log where action = 'payment_correct' and entity = 'payments' and entity_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'У4: правка даты пишется в журнал');
select is((select before->>'paid_on' from audit_log where action = 'payment_correct' and entity_id = '00000000-0000-0000-0000-0000000000b1'), '2026-10-05', 'У4: в журнале сохранена прежняя дата');
select lives_ok($$update match_payments set comment = 'исправлено' where id = '00000000-0000-0000-0000-0000000000e1'$$, 'У4: комментарий платежа матча меняется');
select lives_ok($$insert into payments (player_id, amount, paid_on, method, cancels) values ('00000000-0000-0000-0000-0000000000f1', -100, '2026-10-06', 'Отмена', '00000000-0000-0000-0000-0000000000b1')$$, 'У7: отмена записью с cancels работает');
select is((select count(*)::int from payments where player_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'У7: платёж и отмена остаются в журнале');

-- Каскад от игрока: игрок с платежами не удаляется, без платежей удаляется
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f1'$$, 'P0001', null, 'У2: игрок с платежом (payments, service_payments) не удаляется каскадом');
select is((select count(*)::int from players where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'У2: игрок с платежом остаётся');
select is((select count(*)::int from payments where player_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'У2: платежи игрока остаются');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f3'$$, 'P0001', null, 'У2: игрок с платежом матча не удаляется (через match_fees)');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f4'$$, 'P0001', null, 'У2: игрок с платежом турнира не удаляется (через tournament_fees)');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f5'$$, 'P0001', null, 'У2/У5: игрок с закрытым месяцем не удаляется');
select lives_ok($$delete from subscriptions where player_id = '00000000-0000-0000-0000-0000000000f6'$$, 'У5: открытый месяц удаляется');
select lives_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f6'$$, 'У2: игрок с открытым месяцем без платежей удаляется');
select lives_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f2'$$, 'У2: игрок без записей удаляется как раньше');
select is((select count(*)::int from audit_log where action = 'player_delete' and entity_id = '00000000-0000-0000-0000-0000000000f2'), 1, 'У6: удаление игрока пишется в журнал');
select ok(not (select before ? 'full_name' from audit_log where action = 'player_delete' and entity_id = '00000000-0000-0000-0000-0000000000f2'), 'У6: в журнале нет ФИО игрока');

-- Подписки: закрытый месяц не удаляется, открытый удаляется
select throws_ok($$delete from subscriptions where player_id = '00000000-0000-0000-0000-0000000000f5'$$, 'P0001', null, 'У5: закрытая скидка не удаляется');

-- Штатные сценарии по взносам: оплаченный взнос не снимается, неоплаченный снимается
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select match_fee_remove('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f3')$$, 'P0001', 'fee already paid', 'У7: match_fee_remove отказывает для оплаченного взноса');
select throws_ok($$select event_roster_remove('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000f4')$$, 'P0001', 'fee already paid', 'У7: event_roster_remove отказывает для оплаченного взноса');
select lives_ok($$select match_fee_remove('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f7')$$, 'У7: неоплаченный взнос матча снимается');
select is((select count(*)::int from match_fees where player_id = '00000000-0000-0000-0000-0000000000f7'), 0, 'У7: неоплаченный взнос удалён');

-- Долги не исчезают каскадом от игрока (У12); удаление матча и штатное снятие взноса работают
reset role;
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f8'$$, 'P0001', null, 'У12: игрок с неоплаченным взносом матча не удаляется');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f9'$$, 'P0001', null, 'У12: игрок с неоплаченным взносом турнира не удаляется');
select is((select count(*)::int from match_fees where player_id = '00000000-0000-0000-0000-0000000000f8'), 2, 'У12: долги игрока остаются');
select lives_ok($$delete from matches where id = '00000000-0000-0000-0000-0000000000d2'$$, 'У12: матч с неоплаченным взносом удаляется как раньше');
select is((select count(*)::int from match_fees where player_id = '00000000-0000-0000-0000-0000000000f8'), 1, 'У12: взнос удалённого матча снят каскадом');

-- Вошедшие пользователи не удаляют игроков прямым запросом (У13)
select is(has_table_privilege('authenticated', 'players', 'delete'), false, 'У13: у authenticated нет DELETE на players');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f8'$$, '42501', null, 'У13: администратор не удаляет игрока через API');
select lives_ok($$update players set status = 'inactive' where id = '00000000-0000-0000-0000-0000000000f8'$$, 'У13: администратор переводит игрока в архив (inactive)');
reset role;
select is((select status from players where id = '00000000-0000-0000-0000-0000000000f8'), 'inactive', 'У13: статус inactive сохранён');

-- Права: новые функции не доступны прикладным ролям (У8)
select is(has_function_privilege('authenticated', 'fee_player_cascade_guard()', 'execute'), false, 'У8: authenticated не выполняет fee_player_cascade_guard');
select is(has_function_privilege('anon', 'payment_history_guard()', 'execute'), false, 'У8: anon не выполняет payment_history_guard');
select is(has_function_privilege('authenticated', 'payment_history_guard()', 'execute'), false, 'У8: authenticated не выполняет payment_history_guard');
select is(has_function_privilege('anon', 'payment_history_audit()', 'execute'), false, 'У8: anon не выполняет payment_history_audit');
select is(has_function_privilege('authenticated', 'payment_history_audit()', 'execute'), false, 'У8: authenticated не выполняет payment_history_audit');
select is(has_function_privilege('anon', 'player_delete_audit()', 'execute'), false, 'У8: anon не выполняет player_delete_audit');
select is(has_function_privilege('authenticated', 'player_delete_audit()', 'execute'), false, 'У8: authenticated не выполняет player_delete_audit');
select is(has_function_privilege('authenticated', 'subscription_closure_guard()', 'execute'), false, 'У8: authenticated не выполняет subscription_closure_guard');

-- Триггеры включены (У9): 16 штук
select is((select count(*)::int from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in (
  'payments_history_guard', 'payments_history_no_truncate', 'payments_history_audit',
  'match_payments_history_guard', 'match_payments_history_no_truncate', 'match_payments_history_audit',
  'tournament_payments_history_guard', 'tournament_payments_history_no_truncate', 'tournament_payments_history_audit',
  'service_payments_history_guard', 'service_payments_history_no_truncate', 'service_payments_history_audit',
  'subscriptions_closed_no_delete', 'players_delete_audit',
  'match_fees_player_cascade_guard', 'tournament_fees_player_cascade_guard')), 16, 'У9: все 16 триггеров включены');

select * from finish();
rollback;
