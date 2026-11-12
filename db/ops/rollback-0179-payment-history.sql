-- Откат миграции 0179 (DATA-01, история платежей). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Снимает 16 триггеров и 5 функций, которые добавила 0179, и возвращает authenticated право DELETE на players (как до 0179). Таблицы, данные платежей, подписок, игроков и уже записанный audit_log не меняются.
-- После отката строка 0179 в preflight показывает f: это ожидаемо. Вернуть защиту можно повторным запуском 0179 из db/migrations.
begin;

drop trigger if exists payments_history_audit on payments;
drop trigger if exists payments_history_no_truncate on payments;
drop trigger if exists payments_history_guard on payments;

drop trigger if exists match_payments_history_audit on match_payments;
drop trigger if exists match_payments_history_no_truncate on match_payments;
drop trigger if exists match_payments_history_guard on match_payments;

drop trigger if exists tournament_payments_history_audit on tournament_payments;
drop trigger if exists tournament_payments_history_no_truncate on tournament_payments;
drop trigger if exists tournament_payments_history_guard on tournament_payments;

drop trigger if exists service_payments_history_audit on service_payments;
drop trigger if exists service_payments_history_no_truncate on service_payments;
drop trigger if exists service_payments_history_guard on service_payments;

drop trigger if exists subscriptions_closed_no_delete on subscriptions;
drop trigger if exists players_delete_audit on players;
drop trigger if exists match_fees_player_cascade_guard on match_fees;
drop trigger if exists tournament_fees_player_cascade_guard on tournament_fees;

drop function if exists payment_history_guard();
drop function if exists payment_history_audit();
drop function if exists subscription_closure_guard();
drop function if exists player_delete_audit();
drop function if exists fee_player_cascade_guard();

grant delete on players to authenticated;

commit;
