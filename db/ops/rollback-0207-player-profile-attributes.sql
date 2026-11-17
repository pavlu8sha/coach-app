-- ОТКАТ 0207: удаляет профиль игрока (имя, позиция, номер) и историю.
-- Вместе с откатом откатите веб-приложение: поля профиля и история перестанут читаться.
-- Данные профиля и истории удаляются; при необходимости сначала сделайте выгрузку. Сначала db/ops/preflight.sql.
begin;
drop trigger if exists players_create_profile on players;
drop trigger if exists players_clear_jersey_on_team_change on players;
drop trigger if exists player_profiles_jersey_guard on player_profiles;
drop trigger if exists player_profiles_history on player_profiles;
drop trigger if exists player_profiles_close_jersey on player_profiles;
drop function if exists player_profiles_create();
drop function if exists players_clear_jersey_on_team_change();
drop function if exists player_profiles_before_write();
drop function if exists player_profiles_after_write();
drop function if exists player_profiles_close_jersey();
drop table if exists player_profile_history, player_jersey_history, player_profiles cascade;
drop function if exists player_team_of(uuid);
drop function if exists current_season_start(date);
drop function if exists player_team(text);
commit;
