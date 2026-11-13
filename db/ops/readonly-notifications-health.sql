-- Состояние очереди уведомлений (REL-02, 0184). Только чтение, ничего не меняет. Запускать в SQL Editor целиком.
-- Норма: pending_old = 0, stalled_pending = 0, tg-notify в cron активен и запускался в последние минуты.
-- 1. Сводка
select 'state' as section, state as key, count(*)::text as value from notifications group by state
union all
select 'pending_old', 'pending старше 15 минут', count(*)::text from notifications where state = 'pending' and created_at < now() - interval '15 minutes'
union all
-- до 0184 такие строки висели навсегда; после 0184 должно быть 0 (их закрывает claim_notifications)
select 'stalled_pending', 'pending, attempts>=3, выдача истекла', count(*)::text from notifications
 where state = 'pending' and attempts >= 3 and (claimed_at is null or claimed_at < now() - interval '2 minutes')
union all
select 'oldest_pending', 'возраст самой старой pending', coalesce((now() - min(created_at))::text, '—') from notifications where state = 'pending'
order by 1, 2;

-- 2. Неотправленные за 7 дней: вид и причина
select kind, state, coalesce(left(last_error, 60), '—') as reason, count(*) as n, max(created_at) as last_at
  from notifications
 where state in ('failed', 'skipped') and created_at > now() - interval '7 days'
 group by 1, 2, 3
 order by n desc, kind;

-- 3. Расписание отправителя. Только если установлен pg_cron (иначе запрос падает: таблицы cron.job нет),
--    поэтому запрос закомментирован: снять "-- " и выполнить отдельно.
-- select j.jobid, j.jobname, j.schedule, j.active,
--        (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid) as last_run,
--        (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status
--   from cron.job j order by j.jobname;
