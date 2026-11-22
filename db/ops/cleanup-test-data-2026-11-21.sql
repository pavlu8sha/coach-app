-- Очистка тестовых данных после проверок Павла (21.11.2026). ВЫПОЛНЯЕТ ТОЛЬКО ПАВЕЛ, по шагам, после свежего preflight.
-- Ничего не удаляется само: сначала шаг 1 (чтение), смотрим результат, потом шаги 2-4 по отдельности.
-- Шаги 2-4 пишут в боевую базу и работают ТОЛЬКО по точным id: Павел вставляет в массив ids значения из шага 1 (только строки тестовых дат/документа).
-- Каждый шаг один оператор (один do-блок = одна транзакция): число затронутых строк сверяется с числом id, при несовпадении всё откатывается.
-- Пустой массив ids шаг не выполняет. Если в шаге 1 строк больше ожидаемого, шаги 2-4 не запускать и вернуться в тред.

-- ШАГ 1. Предпросмотр (только чтение): что найдено по двум игрокам и тестовому документу.
select 'отмена записи' as что, c.id::text, p.full_name, c.kind, c.status, c.starts_at::text as когда, c.amount::text as сумма, c.cancelled_at::text as создано
  from booking_cancellations c join players p on p.id = c.player_id
 where p.full_name ilike 'Starostenko%' or p.full_name ilike 'Pankov%'
union all
select 'ответ на матч', i.id::text, p.full_name, 'match_invitations', coalesce(i.response, 'нет'), m.played_on::text, '', coalesce(i.responded_at::text, '')
  from match_invitations i join players p on p.id = i.player_id join matches m on m.id = i.match_id
 where (p.full_name ilike 'Starostenko%' or p.full_name ilike 'Pankov%') and i.response is not null and i.responded_by_coach
union all
select 'журнал матча', a.id::text, '', a.action, a.payload::text, a.match_id::text, '', a.created_at::text
  from match_activity a
 where a.action = 'coach_response' and a.payload->>'player_id' in (select id::text from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%')
union all
select 'документ сбора', d.id::text, d.title, 'версия ' || d.version, d.status, d.storage_path, d.size_bytes::text, d.created_at::text
  from camp_documents d where d.title = 'Тест'
order by 1, 8;

-- ШАГ 2. Отмены записи Starostenko и Pankov: ТОЛЬКО тестовые отмены 14.11 и 15.11 (id из шага 1, строки «отмена записи»).
do $$ declare ids uuid[] := array[]::uuid[]; n int; begin if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'вставьте id из шага 1 в массив ids'; end if; delete from booking_cancellations where id = any (ids) and player_id in (select id from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%'); get diagnostics n = row_count; if n <> array_length(ids, 1) then raise exception 'удалено % строк, ожидалось %: откат', n, array_length(ids, 1); end if; raise notice 'удалено отмен: %', n; end $$;

-- ШАГ 3а. Ответы «Будет / Не будет», которые Павел давал за этих игроков: id приглашений из шага 1 (строки «ответ на матч»). Ответ сбрасывается в «Не ответил».
do $$ declare ids uuid[] := array[]::uuid[]; n int; begin if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'вставьте id из шага 1 в массив ids'; end if; update match_invitations set response = null, responded_by = null, responded_by_coach = false, responded_at = null where id = any (ids) and responded_by_coach and player_id in (select id from players where full_name ilike 'Starostenko%' or full_name ilike 'Pankov%'); get diagnostics n = row_count; if n <> array_length(ids, 1) then raise exception 'изменено % строк, ожидалось %: откат', n, array_length(ids, 1); end if; raise notice 'сброшено ответов: %', n; end $$;

-- ШАГ 3б. Записи журнала матча «coach_response» за эти ответы: id из шага 1 (строки «журнал матча»).
do $$ declare ids bigint[] := array[]::bigint[]; n int; begin if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'вставьте id из шага 1 в массив ids'; end if; delete from match_activity where id = any (ids) and action = 'coach_response'; get diagnostics n = row_count; if n <> array_length(ids, 1) then raise exception 'удалено % строк, ожидалось %: откат', n, array_length(ids, 1); end if; raise notice 'удалено записей журнала: %', n; end $$;

-- ШАГ 4. Тестовый документ сбора «Тест»: ровно одна строка, id из шага 1 (строка «документ сбора»). Строка удаляется от имени владельца базы (у приложения прав на удаление нет по замыслу 0169).
-- Файл в хранилище camp-docs после этого удалить в Supabase: Storage → camp-docs → файл по storage_path из шага 1 (удаление строки storage.objects через SQL файл на диске не удаляет).
-- Триггер camp_documents_no_delete (история документов) выключается и включается обратно внутри одного do-блока: при любой ошибке транзакция откатывается вместе с состоянием триггера.
do $$ declare ids uuid[] := array[]::uuid[]; n int; begin if coalesce(array_length(ids, 1), 0) <> 1 then raise exception 'вставьте ровно один id из шага 1 в массив ids'; end if; alter table camp_documents disable trigger camp_documents_no_delete; delete from camp_documents where id = any (ids) and title = 'Тест'; get diagnostics n = row_count; if n <> 1 then raise exception 'удалено % строк, ожидалась 1: откат', n; end if; alter table camp_documents enable trigger camp_documents_no_delete; raise notice 'удалён тестовый документ, триггер включён'; end $$;
-- Проверка после шага 4 (ожидается enabled = O): select tgenabled from pg_trigger where tgname = 'camp_documents_no_delete' and tgrelid = 'camp_documents'::regclass;
