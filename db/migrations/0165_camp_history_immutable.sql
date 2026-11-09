-- 0165 (Issue #470, условие 3а): финансовая история сборов не удаляется и не перезаписывается.
-- До этого администратор мог прямыми запросами удалять и править camp_payments, camp_participants и camp_tariffs (политики «for all» и права из 0010).
-- Теперь:
--  * платежи, участники и тарифы пишутся только функциями (camp_pay, camp_cancel_payment, camp_register*, camp_update_participant,
--    camp_parent_register, camp_tariff_save, ...); вошедшим пользователям остаётся только чтение (RLS как раньше);
--  * service_role (импорт): платежи select и insert; участники select, insert и update только колонки external_id; тарифы как раньше;
--  * триггеры запрещают update и delete платежей и delete участников, truncate обоих журналов; каскадное удаление игрока или сбора
--    с платежами или участниками тем самым отклоняется;
--  * платёж без вошедшего пользователя (импорт) не получает подделанных автора и времени, не расходится с участником по сбору и игроку,
--    знак суммы соответствует виду, ссылка отмены (legacy_ref 'cancel:...') бывает только у возврата;
--  * отмена платежа остаётся записью возврата (camp_cancel_payment, без изменения исходной строки).
-- Защита действует против всех прикладных ролей (authenticated, service_role, anon). Владелец таблиц (postgres в SQL Editor) может
-- отключить триггер осознанной командой SQL: так делается ручное исправление по согласованию, preflight проверяет, что триггеры включены.
-- Автор и время платежа и раньше не менялись (0077, триггер camp_payments_guard_author срабатывает раньше и даёт 42501).
-- История изменения суммы и тарифа участника в журнал событий пишется с этапа 3 (0166).

drop policy if exists camp_payments_admin on camp_payments;
drop policy if exists camp_participants_admin on camp_participants;

drop policy if exists camp_tariffs_admin on camp_tariffs;
revoke all on camp_payments, camp_participants, camp_tariffs from authenticated, service_role, anon, public;
grant select on camp_tariffs to authenticated;
grant select, insert, update, delete on camp_tariffs to service_role;
grant select on camp_payments to authenticated;
grant select, insert on camp_payments to service_role;
grant select on camp_participants to authenticated;
grant select, insert on camp_participants to service_role;
grant update (external_id) on camp_participants to service_role;

create or replace function camp_history_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'immutable' using errcode = 'P0001';
end $$;
revoke execute on function camp_history_guard() from public, anon, authenticated;

drop trigger if exists camp_payments_immutable on camp_payments;
create trigger camp_payments_immutable before update or delete on camp_payments for each row execute function camp_history_guard();
drop trigger if exists camp_payments_no_truncate on camp_payments;
create trigger camp_payments_no_truncate before truncate on camp_payments for each statement execute function camp_history_guard();
drop trigger if exists camp_participants_no_delete on camp_participants;
create trigger camp_participants_no_delete before delete on camp_participants for each row execute function camp_history_guard();
drop trigger if exists camp_participants_no_truncate on camp_participants;
create trigger camp_participants_no_truncate before truncate on camp_participants for each statement execute function camp_history_guard();

-- Вставка платежа: согласованность с участником, знак суммы, автор
create or replace function camp_payments_insert_guard() returns trigger
language plpgsql set search_path = public as $$
declare p camp_participants;
begin
  select * into p from camp_participants where id = new.participant_id;
  if not found or p.camp_id <> new.camp_id or p.player_id is distinct from new.player_id then raise exception 'bad payment' using errcode = '22023'; end if;
  if (new.kind = 'refund' and new.amount >= 0) or (new.kind in ('booking', 'payment') and new.amount <= 0) then raise exception 'bad payment' using errcode = '22023'; end if;
  if new.legacy_ref like 'cancel:%' and new.kind <> 'refund' then raise exception 'bad payment' using errcode = '22023'; end if;
  if current_user_id() is null then new.recorded_by := null; new.recorded_at := null; end if;
  return new;
end $$;
revoke execute on function camp_payments_insert_guard() from public, anon, authenticated;
drop trigger if exists camp_payments_insert_guard on camp_payments;
create trigger camp_payments_insert_guard before insert on camp_payments for each row execute function camp_payments_insert_guard();
