-- Откат 0216: удалить функцию. Уже исправленные способы оплаты не возвращаются (правки остались в audit_log, payment_correct).
drop function if exists payment_set_method(uuid, text, text);
