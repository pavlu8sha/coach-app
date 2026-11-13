-- ОТКАТ 0192: удаляет remove_match_player. Экран вернётся к прямому delete из match_players, доступному только администратору,
-- поэтому вместе с откатом нужно откатить и веб-приложение (кнопка «Править состав» у тренера перестанет работать).
-- Сначала db/ops/preflight.sql.
begin;
drop function if exists remove_match_player(uuid, uuid);
commit;
