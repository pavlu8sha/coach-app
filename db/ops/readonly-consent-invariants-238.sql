-- #238: read-only проверка инвариантов версий согласий. Запускать ПОСЛЕ применения 0159 (до неё таблиц нет).
-- Ловит результат независимо от способа обхода триггеров (владелец, session_replication_role = replica).
-- Ожидается: «типов без текущей версии» 0 и «типов с закрытой текущей версией» 0 (после выпуска первых версий; пока версий нет, типов в таблице нет).
select 'типов с закрытой текущей версией (ожидается 0)' as metric,
       (select count(*)::text from (select distinct consent_type t from consent_doc_versions) x
         where (select accepting from consent_doc_versions where id = consent_current_version(x.t)) is not true) as value
union all select 'версий с будущей датой, закрытых для подтверждений (ожидается 0)',
       (select count(*)::text from consent_doc_versions where not accepting and effective_from > now())
union all select 'событий истории со ссылкой на несуществующую версию (ожидается 0)',
       (select count(*)::text from parental_consent_events e where not exists (select 1 from consent_doc_versions v where v.id = e.version_id))
union all select 'строк состояния без собственного события (ожидается 0)',
       (select count(*)::text from parental_consents c where c.status <> 'pending' and not exists (select 1 from parental_consent_events e where e.id = c.last_event_id))
union all select 'защитные триггеры согласий включены (ожидается 8 после 0159, 11 после 0162)',
       (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('consent_doc_versions_no_rewrite', 'consent_doc_versions_keep_open', 'consent_doc_versions_no_delete', 'consent_doc_versions_no_truncate', 'parental_consent_events_guard', 'parental_consent_events_no_change', 'parental_consent_events_no_truncate', 'parental_consents_guard', 'consent_versions_lock', 'consent_links_lock', 'consent_on_link_delete'));
