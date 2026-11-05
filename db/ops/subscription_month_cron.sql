-- Расписание автосоздания абонементов (миграция 0128). Выполняет ВЛАДЕЛЕЦ в Supabase SQL Editor после миграции.
-- Предварительно: Database → Extensions → pg_cron → Enable (если уже включён для «ind-autocreate», ничего делать не нужно).
-- 1-го числа в 00:05 UTC = 04:05 по Тбилиси (UTC+4, без перехода на летнее время): создаёт строки абонементов на новый месяц.
select cron.schedule('subscription-month-auto', '5 0 1 * *', $$ select subscription_month_auto(null) $$);

-- Проверка расписания: select jobname, schedule, active from cron.job where jobname = 'subscription-month-auto';
-- Журнал запусков: select status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'subscription-month-auto' order by start_time desc limit 5;
-- Разовый запуск вручную: select subscription_month_auto(null);   -- вернёт число созданных строк (0, если всё уже есть)
-- Остановить: select cron.unschedule('subscription-month-auto');
-- Откат миграции: unschedule; drop function subscription_month_auto(date), subscription_month_missing(date).
