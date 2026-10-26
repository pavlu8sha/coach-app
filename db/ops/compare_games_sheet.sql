-- Сверка листа «Игры» старого файла (таблица «Посещаемость тренировок и игр_тренеры») с таблицей matches нового приложения. ТОЛЬКО ЧТЕНИЕ.
-- Что сверяется: наличие матча (дата + команда) и счёт «наши:соперник». Голы игроков здесь не сверяются.
-- Листы сняты 2026-10-26; если в таблице что-то изменится, строки ниже надо обновить.
-- Как запускать: SQL Editor в Supabase, целиком. Пустой результат (кроме последней строки со сводкой) = полное совпадение.
-- Команда «U12» — это не «Ortachala U12» (решение владельца): сверяется как есть. Матч Newton cup (команда U12) в листе «Игры» может отсутствовать — это ожидаемо. Пометки «(техн.)» и «(пен.)» отбрасываются, сверяется счёт.
with sheet(played_on, team, opponent, score) as (values
  ('2026-03-08', 'U9-A', '', ''),
  ('2026-03-08', 'U9-B', '', ''),
  ('2026-03-09', 'U10', '', '4:2'),
  ('2026-03-10', 'U11', '', '10:0'),
  ('2026-03-14', 'U10', '', '6:2'),
  ('2026-03-14', 'U11', '', '1:2'),
  ('2026-03-14', 'U9-B', '', ''),
  ('2026-03-15', 'U9-A', '', ''),
  ('2026-03-24', 'U13-A', '', ''),
  ('2026-03-28', 'U9-A', '', ''),
  ('2026-03-28', 'U13-A', '', ''),
  ('2026-03-28', 'U11', '', '3:0 (техн.)'),
  ('2026-03-29', 'U10', '', '3:1'),
  ('2026-03-29', 'U9-B', '', ''),
  ('2026-04-04', 'U11', '', '7:2'),
  ('2026-04-05', 'U9-A', '', ''),
  ('2026-04-05', 'U10', '', '8:0'),
  ('2026-04-05', 'U9-B', '', ''),
  ('2026-04-18', 'U9-A', '', ''),
  ('2026-04-18', 'U13-A', '', ''),
  ('2026-04-18', 'U10', '', '2:0'),
  ('2026-04-18', 'U11', '', '4:2'),
  ('2026-04-18', 'U9-B', '', ''),
  ('2026-04-25', 'U9-A', '', ''),
  ('2026-04-25', 'U13-A', '', ''),
  ('2026-04-25', 'U10', '', '11:2'),
  ('2026-04-25', 'U9-B', '', ''),
  ('2026-04-26', 'U13-A', '', ''),
  ('2026-04-26', 'U11', '', '10:5'),
  ('2026-05-02', 'U13-A', '', ''),
  ('2026-05-02', 'U10', '', '6:3'),
  ('2026-05-03', 'U9-A', '', ''),
  ('2026-05-03', 'U11', '', '3:3'),
  ('2026-05-09', 'U10', '', '0:0'),
  ('2026-05-09', 'U9-B', '', ''),
  ('2026-05-10', 'U9-A', '', ''),
  ('2026-05-10', 'U11', '', '4:0'),
  ('2026-05-12', 'U13-A', '', ''),
  ('2026-05-16', 'U13-A', '', ''),
  ('2026-05-16', 'U10', '', '6:1'),
  ('2026-05-17', 'U9-A', '', ''),
  ('2026-05-17', 'U11', '', '11:0'),
  ('2026-05-17', 'U9-B', '', ''),
  ('2026-05-23', 'U13-A', '', ''),
  ('2026-05-23', 'U10', '', '3:0'),
  ('2026-05-23', 'U11', '', '6:0'),
  ('2026-05-24', 'U9-A', '', ''),
  ('2026-05-24', 'U9-B', '', ''),
  ('2026-05-30', 'U10', '', '3:0 (техн.)'),
  ('2026-05-30', 'U11', '', '3:2'),
  ('2026-05-30', 'U9-B', '', ''),
  ('2026-05-31', 'U9-A', '', ''),
  ('2026-06-06', 'U11', '', '4:3'),
  ('2026-09-10', 'U9', 'FC Gldani-2', '3:6'),
  ('2026-09-10', 'U10', 'FC Gldani', '0:3'),
  ('2026-09-10', 'U11', 'FC New Star-B', '0:4'),
  ('2026-09-10', 'U13-A', 'FC Gldani', '0:12'),
  ('2026-09-11', 'U11', 'FC Sansona', '0:4'),
  ('2026-09-11', 'U9', 'FC Sansona', '1:1'),
  ('2026-09-11', 'U10', 'FC Junker', '3:0'),
  ('2026-09-11', 'U13-A', 'FC N. Dinamo', '1:1'),
  ('2026-09-12', 'U13-A', 'FC Tbilisi-2025', '0:1'),
  ('2026-09-12', 'U11', 'FC N. Dinamo', '0:2'),
  ('2026-09-12', 'U10', 'FC Iberia 2017', '0:2'),
  ('2026-09-12', 'U9', 'FC Junker', '3:0 (техн.)'),
  ('2026-09-13', 'U9', 'FC Tbilisi 2025', '1:2 (пен.)'),
  ('2026-09-19', 'U9-A', 'FC Gldani', '1:4'),
  ('2026-09-19', 'U9-B', 'FC Tbilisi-2025', '2:6'),
  ('2026-09-20', 'U10', 'FC Dighomi', '7:1'),
  ('2026-09-20', 'U13-A', 'FC Sulalvelidze', '0:1'),
  ('2026-09-26', 'U10', 'FC Sansona', '10:0'),
  ('2026-09-26', 'U13-A', 'FC Prone', '2:3'),
  ('2026-09-27', 'U9-A', 'FC Tbilisi-2025', '0:4'),
  ('2026-09-27', 'U9-B', 'FC Dinamo school', '1:8'),
  ('2026-09-27', 'U11', 'FC Sulakvelidze', '1:0'),
  ('2026-10-03', 'U13-A', 'FC Dinamo (Rustavi)', '2:2'),
  ('2026-10-03', 'U11', 'FC Norchi Dinamo', '1:1'),
  ('2026-10-04', 'U9-A', 'FC Dinamo school', '1:0'),
  ('2026-10-04', 'U9-B', 'FC Sansona', '2:8'),
  ('2026-10-04', 'U10', 'FC Academy Gldani', '3:7'),
  ('2026-10-05', 'U13-A', 'FC Gantiadi (Kaspi)', '1:3'),
  ('2026-10-10', 'U9-A', 'U9-B', '9:2'),
  ('2026-10-10', 'U9-B', 'U9-A', '2:9'),
  ('2026-10-11', 'U11', 'FC Dighomi', '3:3'),
  ('2026-10-11', 'U10', 'FC All star', '1:2'),
  ('2026-10-16', 'U13-A', 'FC Champion-1', '3:2'),
  ('2026-10-17', 'U11', 'FC Sansona', '12:5'),
  ('2026-10-17', 'U9-A', 'FC Sansona-1', '1:10'),
  ('2026-10-18', 'U10', 'FC New Star', '4:0'),
  ('2026-10-18', 'U13-B', 'FC Sairme', '0:7'),
  ('2026-10-24', 'U7', 'FC Basiani', '3:8'),
  ('2026-10-24', 'U13-B', 'U12', ''),
  ('2026-10-24', 'U12', 'U13-B', ''),
  ('2026-10-24', 'U11', 'FC Tbilisi-2025', '5:4'),
  ('2026-10-24', 'U10', 'FC Kvartali', '9:3'),
  ('2026-10-24', 'U9-B', 'FC Tbilisi-2025', '2:4'),
  ('2026-10-25', 'U13-A', 'FC Makhata', '4:1')
),
s as (
  select played_on::date as played_on,
         team,
         opponent,
         nullif(score, '') as score,
         (regexp_match(score, '^(\d+):(\d+)'))[1]::int as gf,
         (regexp_match(score, '^(\d+):(\d+)'))[2]::int as ga
  from sheet
),
a as (
  select id, played_on, team, opponent, goals_for, goals_against
  from matches
  where played_on >= date '2026-03-08'
),
j as (
  select s.played_on as sheet_date, s.team as sheet_team, s.opponent as sheet_opp, s.score as sheet_score, s.gf, s.ga,
         a.id, a.played_on as app_date, a.team as app_team, a.opponent as app_opp, a.goals_for, a.goals_against
  from s full join a on a.played_on = s.played_on and a.team = s.team
)
select status, d as match_date, team, sheet_score, app_score, opponent_sheet, opponent_app, match_id from (
  select case
           when id is null then '1. НЕТ В ПРИЛОЖЕНИИ'
           when sheet_date is null then '2. НЕТ В ТАБЛИЦЕ'
           when sheet_score is not null and goals_for is null then '3. СЧЁТ ТОЛЬКО В ТАБЛИЦЕ'
           when sheet_score is null and goals_for is not null then '4. СЧЁТ ТОЛЬКО В ПРИЛОЖЕНИИ'
           when sheet_score is not null and (gf, ga) is distinct from (goals_for, goals_against) then '5. СЧЁТ РАЗНЫЙ'
         end as status,
         coalesce(sheet_date, app_date) as d, coalesce(sheet_team, app_team) as team,
         sheet_score, case when goals_for is null then null else goals_for || ':' || goals_against end as app_score,
         sheet_opp as opponent_sheet, app_opp as opponent_app, id as match_id
  from j
) x
where status is not null
union all
select '0. СВОДКА: строк в таблице ' || (select count(*) from s) || ', матчей в приложении с 2026-03-08 ' || (select count(*) from a)
       || ', совпало полностью ' || (select count(*) from j where id is not null and sheet_date is not null
            and ((sheet_score is null and goals_for is null) or (sheet_score is not null and (gf, ga) is not distinct from (goals_for, goals_against)))),
       null, null, null, null, null, null, null
order by 1, 2, 3;
