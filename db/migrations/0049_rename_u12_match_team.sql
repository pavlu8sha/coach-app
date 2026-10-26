-- 0049: команда матча «U12» → «Ortachala U12» (Issue #172, решение владельца: одна строка matches).
-- Остальные несовпадения (U10, U9, U7) решает правило с суффиксом -A/-B/-C в can_see_team (0048), данные там не меняются.
-- Меняется только matches.team; турниры (tournaments.team), деньги, баллы и посещаемость не затрагиваются.
-- Повторный запуск безопасен: после переименования строк с командой «U12» нет. Переименование только если группа «Ortachala U12» есть в клубе матча.
update matches m set team = 'Ortachala U12'
where m.team = 'U12'
  and exists (select 1 from groups g where g.club_id = m.club_id and g.name = 'Ortachala U12');
