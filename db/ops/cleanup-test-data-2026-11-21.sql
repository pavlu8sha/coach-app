-- Очистка тестовых данных после проверок Павла (21.11.2026). ВЫПОЛНЯЕТ ТОЛЬКО ПАВЕЛ, по шагам, после свежего preflight.
-- Ничего не удаляется само: сначала шаг 1 (чтение), смотрим результат, потом шаги 2-4 по отдельности.
-- Шаги 2-4 пишут в боевую базу. Если в шаге 1 строк больше ожидаемого, шаги 2-4 не запускать и вернуться в тред.

-- ШАГ 1. Предпросмотр (только чтение): что найдено по двум игрокам и тестовому документу.
select 'отмена записи' as что, c.id::text, p.full_name, c.kind, c.status, c.starts_at::text as когда, c.amount::text as сумма, c.cancelled_at::text as создано
  from booking_cancellations c join players p on p.id = c.player_id
 where p.full_name ilike 'Starostenko%' or p.full_name ilike 'Pankov%'
union all
select 'ответ на матч', i.id::text, p.full_name, 'match_invitations', coalesce(i.response, 'нет'), m.played_on::text, '', coalesce(i.responded_at::text, '')
  from match_invitations i join players p on p.id = i.player_id join matches m on m.id = i.match_id
 where (p.full_name ilike 'Starostenko%' or p.full_name ilike 'Pankov%') and i.response is not null
union all
select 'журнал матча', a.id::text, '', a.action, a.payload::text, a.match_id::text, '', a.created_at::text
  from match_activity a
 where a.action = 'coach_response' and a.payload->>'player_id' in (select id::text from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%')
union all
select 'документ сбора', d.id::text, d.title, 'версия ' || d.version, d.status, d.storage_path, d.size_bytes::text, d.created_at::text
  from camp_documents d where d.title = 'Тест'
order by 1, 8;

-- ШАГ 2. Записи об отменах Starostenko и Pankov (если в шаге 1 это только тестовые отмены 14.11 и 15.11).
delete from booking_cancellations where player_id in (select id from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%') returning id, kind, status, starts_at;

-- ШАГ 3. Ответы «Будет / Не будет», которые Павел давал за этих игроков: ответ сбрасывается в «Не ответил», записи журнала удаляются.
update match_invitations set response = null, responded_by = null, responded_by_coach = false, responded_at = null where response is not null and responded_by_coach and player_id in (select id from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%') returning id, match_id, player_id;
delete from match_activity where action = 'coach_response' and payload->>'player_id' in (select id::text from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%') returning id, match_id;

-- ШАГ 4. Тестовый документ сбора «Тест» (версия 1). Строки удаляются от имени владельца базы (у приложения прав на удаление нет по замыслу 0169).
-- Файл в хранилище camp-docs после этого удалить в Supabase: Storage → camp-docs → файл по storage_path из шага 1 (удаление строки storage.objects через SQL файл на диске не удаляет).
-- Удаление закрыто триггером camp_documents_no_delete (история документов): на время удаления выключаем, сразу включаем обратно. Три строки запускать вместе.
alter table camp_documents disable trigger camp_documents_no_delete;
delete from camp_documents where title = 'Тест' returning id, doc_id, version, storage_path;
alter table camp_documents enable trigger camp_documents_no_delete;
