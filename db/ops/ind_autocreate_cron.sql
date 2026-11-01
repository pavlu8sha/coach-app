-- Расписание автосоздания индивидуальных (#336, миграция 0090). Выполняет ВЛАДЕЛЕЦ в Supabase SQL Editor после миграции.
-- Предварительно: Database → Extensions → включить pg_cron (если уведомления бота через tg-notify уже работают, он включён).
-- Вторник 09:00 по Тбилиси = 05:00 UTC (Тбилиси UTC+4, без перехода на летнее время). Создаёт занятия на ближайшие выходные.
select cron.schedule('ind-autocreate', '0 5 * * 2', $$ select ind_autocreate(null) $$);

-- Проверка: select * from cron.job where jobname = 'ind-autocreate';
-- Разовый запуск вручную (без ожидания вторника): select ind_autocreate(null);   -- или кнопка «Создать занятия на выходные» у админа
-- Остановить: select cron.unschedule('ind-autocreate');
-- Откат миграции: unschedule; delete from individual_sessions s where s.auto and not exists (select 1 from individual_bookings b where b.session_id = s.id);
--   затем drop function ind_autocreate(date), ind_autocreate_now(), ind_slot_member_set(uuid,uuid,date,boolean), ind_ext_id(date,time,boolean);
--   drop table individual_slot_members, individual_skips, individual_templates; alter table individual_sessions drop column auto.
--   (ind_delete_session и ind_edit_session вернуть к версиям 0034/0052.)
