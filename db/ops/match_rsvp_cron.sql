-- Расписание автоматических напоминаний о матчах (миграция 0137). Выполняет ВЛАДЕЛЕЦ в Supabase SQL Editor после миграции.
-- Предварительно: Database → Extensions → pg_cron → Enable (если уже включён, ничего делать не нужно).
-- Каждые 10 минут: ставит в очередь напоминания не ответившим родителям (за 48 и за 24 часа до матча). Лимит «одно напоминание
-- родителю в сутки» и защита от дублей проверяет сама функция; повторный запуск ничего лишнего не создаёт.
select cron.schedule('match-rsvp-auto-reminders', '*/10 * * * *', $$ select rsvp_auto_reminders() $$);

-- Проверка расписания: select jobname, schedule, active from cron.job where jobname = 'match-rsvp-auto-reminders';
-- Журнал запусков: select status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'match-rsvp-auto-reminders' order by start_time desc limit 5;
-- Разовый запуск вручную: select rsvp_auto_reminders();   -- вернёт число поставленных напоминаний
-- Остановить: select cron.unschedule('match-rsvp-auto-reminders');
