-- Откат 0217: убрать my_link_requests() и my_pending_consents(). Данные, права и RLS не затрагиваются.
-- Приложение без этих функций работает по-прежнему (имя «Игрок», экран согласия не показывается).
drop function if exists my_link_requests();
drop function if exists my_pending_consents();
