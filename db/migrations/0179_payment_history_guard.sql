-- 0179 (DATA-01, аудит 2026-11-11, docs/PAYMENT_HISTORY_ACCEPTANCE.md): история платежей не стирается каскадом и не переписывается молча.
-- До этого удаление игрока каскадно удаляло payments, match_payments (через match_fees), tournament_payments (через tournament_fees),
-- service_payments и subscriptions; прямой DELETE давал администратору и service_role то же самое; триггеров защиты не было.
-- Теперь:
--  * DELETE и TRUNCATE платежей (payments, match_payments, tournament_payments, service_payments) запрещены всем ролям.
--    Каскад от игрока или взноса, у которого есть платёж, отклоняется целиком (игрок с платежами не удаляется; архив = статус inactive);
--  * UPDATE меняет только даты и способ оплаты, комментарий журнала и служебные метки автора; сумма, игрок, родительская ссылка,
--    cancels, subscription_id, legacy_ref и created_at не меняются. Каждая разрешённая правка пишется в audit_log (payment_correct, before/after);
--  * исправление суммы делается минусовой записью (как уже принято), отмена остаётся записью с cancels;
--  * закрытый месяц подписки (discount или written_off) не удаляется; открытый удаляется как раньше;
--  * удаление игрока без платежей пишется в audit_log (player_delete) с id, club_id и status, без ФИО и контактов;
--  * новые функции не выполняются ролями anon и authenticated (EXECUTE отозван, как у camp_history_guard в 0165).
--  * долги match_fees и tournament_fees не удаляются каскадом от игрока; DELETE на players у authenticated отозван.
-- Владелец (postgres в SQL Editor) может отключить триггер осознанной командой для ручной правки по согласованию;
-- preflight показывает f, пока триггеры не включены. Откат: db/ops/rollback-0179-payment-history.sql.

-- Общий запрет: UPDATE разрешён только для столбцов, перечисленных аргументами триггера; DELETE и TRUNCATE запрещены всегда.
create or replace function payment_history_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old) - tg_argv) is distinct from (to_jsonb(new) - tg_argv) then
      raise exception 'payment history is immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'payment history is immutable' using errcode = 'P0001';
end $$;
revoke execute on function payment_history_guard() from public, anon, authenticated;

-- Журнал правок: запись пишется при любом изменении разрешённых столбцов (запрещённые правки до журнала не доходят).
create or replace function payment_history_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_jsonb(old) is distinct from to_jsonb(new) then
    insert into audit_log (actor_id, action, entity, entity_id, before, after)
    values (current_user_id(), 'payment_correct', tg_table_name, old.id, to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end $$;
revoke execute on function payment_history_audit() from public, anon, authenticated;

-- Закрытый месяц подписки (скидка или списание) не удаляется.
create or replace function subscription_closure_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.discount or old.written_off then
    raise exception 'closed month is immutable' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function subscription_closure_guard() from public, anon, authenticated;

-- Удаление игрока без платежей: след без персональных данных.
create or replace function player_delete_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity, entity_id, before)
  values (current_user_id(), 'player_delete', 'players', old.id, jsonb_build_object('id', old.id, 'club_id', old.club_id, 'status', old.status));
  return null;
end $$;
revoke execute on function player_delete_audit() from public, anon, authenticated;

-- Четыре таблицы платежей: одинаковый набор триггеров.
drop trigger if exists payments_history_guard on payments;
create trigger payments_history_guard before update or delete on payments for each row
  execute function payment_history_guard('paid_on', 'for_month', 'method', 'pay_month', 'comment', 'recorded_by', 'recorded_at');
drop trigger if exists payments_history_no_truncate on payments;
create trigger payments_history_no_truncate before truncate on payments for each statement execute function payment_history_guard();
drop trigger if exists payments_history_audit on payments;
create trigger payments_history_audit after update on payments for each row execute function payment_history_audit();

drop trigger if exists match_payments_history_guard on match_payments;
create trigger match_payments_history_guard before update or delete on match_payments for each row
  execute function payment_history_guard('paid_on', 'for_month', 'method', 'pay_month', 'comment', 'recorded_by', 'recorded_at');
drop trigger if exists match_payments_history_no_truncate on match_payments;
create trigger match_payments_history_no_truncate before truncate on match_payments for each statement execute function payment_history_guard();
drop trigger if exists match_payments_history_audit on match_payments;
create trigger match_payments_history_audit after update on match_payments for each row execute function payment_history_audit();

drop trigger if exists tournament_payments_history_guard on tournament_payments;
create trigger tournament_payments_history_guard before update or delete on tournament_payments for each row
  execute function payment_history_guard('paid_on', 'for_month', 'method', 'pay_month', 'comment', 'recorded_by', 'recorded_at');
drop trigger if exists tournament_payments_history_no_truncate on tournament_payments;
create trigger tournament_payments_history_no_truncate before truncate on tournament_payments for each statement execute function payment_history_guard();
drop trigger if exists tournament_payments_history_audit on tournament_payments;
create trigger tournament_payments_history_audit after update on tournament_payments for each row execute function payment_history_audit();

drop trigger if exists service_payments_history_guard on service_payments;
create trigger service_payments_history_guard before update or delete on service_payments for each row
  execute function payment_history_guard('paid_on', 'for_month', 'method', 'pay_month', 'comment', 'recorded_by', 'recorded_at');
drop trigger if exists service_payments_history_no_truncate on service_payments;
create trigger service_payments_history_no_truncate before truncate on service_payments for each statement execute function payment_history_guard();
drop trigger if exists service_payments_history_audit on service_payments;
create trigger service_payments_history_audit after update on service_payments for each row execute function payment_history_audit();

drop trigger if exists subscriptions_closed_no_delete on subscriptions;
create trigger subscriptions_closed_no_delete before delete on subscriptions for each row execute function subscription_closure_guard();

drop trigger if exists players_delete_audit on players;
create trigger players_delete_audit after delete on players for each row execute function player_delete_audit();

-- Долги (взносы матчей и турниров) не исчезают каскадом при удалении игрока.
-- Штатное снятие неоплаченного взноса (match_fee_remove, event_roster_remove, пересчёт гостевых взносов 0153/0155)
-- и каскад от удаления матча или турнира работают как раньше: запрет срабатывает, только когда игрока уже нет (каскад от players).
-- security definer: проверка видит игрока независимо от RLS вызывающего.
create or replace function fee_player_cascade_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from players where id = old.player_id) then
    raise exception 'player fees are kept' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function fee_player_cascade_guard() from public, anon, authenticated;

drop trigger if exists match_fees_player_cascade_guard on match_fees;
create trigger match_fees_player_cascade_guard before delete on match_fees for each row execute function fee_player_cascade_guard();
drop trigger if exists tournament_fees_player_cascade_guard on tournament_fees;
create trigger tournament_fees_player_cascade_guard before delete on tournament_fees for each row execute function fee_player_cascade_guard();

-- Игрока удаляют только владелец в SQL Editor и функции; вошедшим пользователям (в том числе администратору через API) DELETE закрыт.
-- В интерфейсе удаления нет, выбывший игрок переводится в статус inactive.
revoke delete on players from authenticated;
