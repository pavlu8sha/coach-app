-- Откат 0191 (журнал изменений тарифов и сборов). Удаляет триггеры и таблицу журнала (записи журнала теряются!) и возвращает
-- прямую запись администратору в camps (политика camps_admin и права из 0010). Запускает только владелец в SQL Editor.
begin;
drop trigger if exists camp_tariffs_change_log on camp_tariffs;
drop trigger if exists camps_change_log on camps;
drop function if exists camp_change_log_write();
-- журнал неизменяем: перед удалением снимаем защиту осознанно
alter table camp_change_log disable trigger camp_change_log_immutable;
alter table camp_change_log disable trigger camp_change_log_no_truncate;
drop table if exists camp_change_log;
grant select, insert, update, delete on camps to authenticated;
create policy camps_admin on camps for all using (is_admin()) with check (is_admin());
commit;
