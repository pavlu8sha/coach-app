-- Миграции 0048–0050 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0048.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0048 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0048_can_see_team_group_suffix.sql =====
-- 0048: команда матча совпадает с группой не только по точному названию, но и по названию группы без суффикса -A/-B/-C.
-- В играх команда записана как «U10», «U9», «U7», а группы называются «U10-A», «U10-B» и т.д. (решение владельца, Issue #172).
-- Суффикс строго в конце названия, одна буква: «Ortachala U9» (без суффикса) с «U9-A»/«U9-B» не склеивается.
-- Данные (matches.team) не меняются, права не расширяются: по-прежнему нужна связь с группой (тренер группы или родитель её игрока).
create or replace function can_see_team(c uuid, t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups g
    where g.club_id = c
      and (g.name = t or (g.name ~ '-[ABC]$' and left(g.name, length(g.name) - 2) = t))
      and (is_coach_of_group(g.id) or is_guardian_in_group(g.id))
  )
$$;

revoke execute on function can_see_team(uuid, text) from public;
grant execute on function can_see_team(uuid, text) to authenticated;

-- ===== 0049_rename_u12_match_team.sql =====
-- 0049: команда матча «U12» → «Ortachala U12» (Issue #172, решение владельца: одна строка matches).
-- Остальные несовпадения (U10, U9, U7) решает правило с суффиксом -A/-B/-C в can_see_team (0048), данные там не меняются.
-- Меняется только matches.team; турниры (tournaments.team), деньги, баллы и посещаемость не затрагиваются.
-- Повторный запуск безопасен: после переименования строк с командой «U12» нет. Переименование только если группа «Ortachala U12» есть в клубе матча.
update matches m set team = 'Ortachala U12'
where m.team = 'U12'
  and exists (select 1 from groups g where g.club_id = m.club_id and g.name = 'Ortachala U12');

-- ===== 0050_ind_goalkeepers_backfill.sql =====
-- Вратарские занятия, импортированные из таблиц, не помечены признаком «вратари»: колонка goalkeepers появилась в 0034 со значением
-- по умолчанию false, а импорт (0008) различал их только по внешнему ключу (IND-ГГГГ-ММ-ДД-ЧЧММ-GK) и теме «Вратари…».
-- Из-за этого в «Ещё → Индивидуальные» все занятия выглядели индивидуальными. Проставляем признак по внешнему ключу (как создаёт приложение).
-- Повторный запуск безопасен: затрагиваются только строки, где признак ещё не стоит.
update individual_sessions set goalkeepers = true where external_id like '%-GK' and not goalkeepers;

commit;
