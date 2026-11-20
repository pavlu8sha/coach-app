-- Откат 0214 (#724): убрать payment_add, индекс и столбец request_id. Платежи и суммы не затрагиваются.
-- Перед откатом выложить версию интерфейса без payment_add, иначе запись платежей сломается. Ключи операций будут потеряны.
-- Триггер 0179 запрещает изменение строк, но не изменение структуры; drop column выполняет владелец в SQL Editor.
drop function if exists payment_add(uuid, uuid, numeric, date, text, date);
drop index if exists payments_request_uq;
alter table payments drop column if exists request_id;
