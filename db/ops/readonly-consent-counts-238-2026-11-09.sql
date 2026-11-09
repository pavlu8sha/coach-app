-- #238: read-only подсчёты перед внедрением двух согласий. Ничего не меняет, персональные данные не выводит
-- (только количества и безличные списки миграций). Запустить в SQL Editor целиком; результат — одна таблица.
-- Проверка применения миграций: в базе нет таблицы с журналом миграций, применённость определяется по объектам
-- (так же, как в db/ops/preflight.sql). Здесь — только миграции, важные для #238.
with mig(k, v) as (
  select '0157_eq_add_payment_date_guard',
    coalesce((select position('bad date' in prosrc) > 0 from pg_proc where proname = 'eq_add_payment' limit 1), false)::text
  union all select '0158_booking_telegram',
    (to_regproc('booking_signup_by_telegram') is not null and to_regproc('waitlist_join_by_telegram') is not null and to_regproc('booking_options_by_telegram') is not null)::text
  union all select '0159_consent_model (PR 1 #238)', (to_regclass('parental_consents') is not null)::text
)
select 'миграция: ' || k as metric, v as value from mig
union all select 'связей родитель–ребёнок, действующих по старой модели',
  (select count(*)::text from player_guardians where consent_revoked_at is null)
union all select '— из них у детей со статусом «занимается»',
  (select count(*)::text from player_guardians g join players p on p.id = g.player_id where g.consent_revoked_at is null and p.status = 'active')
union all select 'родителей с хотя бы одной действующей связью',
  (select count(distinct user_id)::text from player_guardians where consent_revoked_at is null)
union all select 'связей, отозванных по старой модели',
  (select count(*)::text from player_guardians where consent_revoked_at is not null)
union all select 'связей по версиям старого согласия: ' || coalesce(consent_version, '(нет)'),
  count(*)::text from player_guardians where consent_revoked_at is null group by consent_version
union all select 'аккаунтов детей (child_links)', (select count(*)::text from child_links)
union all select '— из них у детей с действующей связью родителя',
  (select count(*)::text from child_links c where exists (select 1 from player_guardians g where g.player_id = c.player_id and g.consent_revoked_at is null))
union all select 'действующих кодов для ребёнка (child_codes, не истёкших)',
  (select count(*)::text from child_codes where used_at is null and expires_at > now())
union all select 'запросов на связь в ожидании', (select count(*)::text from link_requests where status = 'pending')
union all select 'очередь уведомлений: ожидают отправки',
  (select count(*)::text from notifications where state = 'pending')
union all select 'открытых запросов на удаление данных', (select count(*)::text from data_requests where status = 'open')
union all select 'версий согласия в базе (старая таблица): ' || version || case when active then ' (активна)' else ' (выключена)' end || case when coach_contacts then ', контакты тренерам' else '' end,
  '1' from consent_versions
order by 1;
