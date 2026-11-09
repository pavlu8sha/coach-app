-- 0165 (Issue #470, условие 3а): финансовая история сборов не удаляется и не перезаписывается.
-- До этого администратор мог прямыми запросами удалять и править camp_payments и camp_participants (политики «for all» и права 0010).
-- Теперь:
--  * платежи и участники пишутся только функциями (camp_pay, camp_cancel_payment, camp_register*, camp_update_participant, camp_parent_register, ...);
--    вошедшим пользователям остаётся только чтение (RLS как раньше);
--  * service_role: платежи только select и insert (импорт добавляет платежи), участники select, insert, update (импорт), без delete;
--  * триггеры запрещают update и delete платежей и delete участников всем ролям, включая владельца базы; truncate обоих журналов запрещён;
--    каскадное удаление игрока или сбора с платежами или участниками тем самым отклоняется;
--  * отмена платежа остаётся записью возврата (camp_cancel_payment, без изменения исходной строки).
-- Автор и время платежа и раньше не менялись (0077, триггер camp_payments_guard_author срабатывает раньше и даёт 42501).

drop policy if exists camp_payments_admin on camp_payments;
drop policy if exists camp_participants_admin on camp_participants;

revoke insert, update, delete, truncate on camp_payments from authenticated, service_role, anon, public;
grant select on camp_payments to authenticated;
grant select, insert on camp_payments to service_role;
revoke insert, update, delete, truncate on camp_participants from authenticated, service_role, anon, public;
grant select on camp_participants to authenticated;
grant select, insert, update on camp_participants to service_role;

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
