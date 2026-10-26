-- Что из объектов миграций 0029–0046 уже есть в базе. Только чтение, ничего не меняет.
-- Нужна, если пакет apply_all.sql упал с «already exists»: показывает, какие части уже применены.
select 'таблица' as вид, n as имя, to_regclass(n) is not null as есть
from unnest(array['extra_sessions','extra_bookings','lead_drafts','match_staff','club_photos','individual_regulars','equipment_issues','equipment_catalog']) n
union all
select 'триггер', n, exists (select 1 from pg_trigger where tgname = n and not tgisinternal)
from unnest(array['coach_groups_notify','payments_notify','point_events_notify','link_requests_notify']) n
union all
select 'политика', n, exists (select 1 from pg_policies where policyname = n)
from unnest(array['individual_regulars_admin','extra_sessions_admin','extra_bookings_admin','equipment_issues_admin','equipment_issues_read','points_read','players_read','groups_read','sessions_read','attendance_read','matches_read','match_players_read','weekly_schedule_read','match_staff_admin','club_photos_read']) n
union all
select 'колонка', t || '.' || c, exists (select 1 from information_schema.columns where table_name = t and column_name = c)
from (values ('subscriptions','written_off'),('individual_sessions','goalkeepers'),('individual_bookings','attended'),('trials','telegram_id'),('trials','updated_at')) v(t, c)
union all
select 'функция', n, exists (select 1 from pg_proc where proname = n)
from unnest(array['enqueue_to_guardians','notify_coach_group','notify_payment','notify_bonus','create_child_code','attendance_stats','match_stats','ind_book','ind_create_session','tl_add','camp_save','lead_submit_app','points_start','match_tournaments','trainer_attendance','trainer_stats','booking_signup','club_photo_set']) n
order by 1, 2;
