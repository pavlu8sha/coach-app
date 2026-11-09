-- Только чтение. Запускается в Supabase SQL Editor после применения 0169 и перед первой загрузкой документа.
-- Проверяет, что хранилище документов сборов закрыто: оно не публичное и ни одна политика хранилища его не открывает.
-- Ожидаемо: bucket_private = true, а второй запрос не возвращает строк (любая строка: политика, которую надо разобрать).
select id, not public as bucket_private, file_size_limit, allowed_mime_types from storage.buckets where id = 'camp-docs';

select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%' or coalesce(qual, '') || coalesce(with_check, '') like '%camp-docs%');
