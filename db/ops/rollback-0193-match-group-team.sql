-- ОТКАТ 0193: удаляет set_match_team_group. Матчи, уже записанные как «U13-B», остаются с этой командой (видимость и статистика
-- работают по названию); чтобы вернуть их в «U13», сначала выполните: update matches set team = regexp_replace(team, '-[A-Z]$', '') where team ~ '-[A-Z]$';
-- Вместе с откатом откатите веб-приложение (галочка «Матч только этой группы»). Сначала db/ops/preflight.sql.
begin;
drop function if exists set_match_team_group(uuid, uuid, boolean);
commit;
