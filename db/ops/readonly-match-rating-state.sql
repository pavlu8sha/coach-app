-- Только чтение. Состояние данных перед переходом на баллы за матч по оценке тренера (docs/MATCH_RATING_SWITCH_PLAN.md, #18).
-- Работает и ДО применения 0223 (колонка performance_rating читается через to_jsonb: до 0223 оценок нет). Ничего не меняет, один запрос.
-- Дата запуска модели: 2026-12-01 (версия правил). Меняется в первой строке CTE launch.
with launch(d) as (select date '2026-12-01'),
-- 1-2. старые point_events и журнал points_ledger по матчам
legacy as (select count(*) as n, coalesce(sum(points), 0) as pts, min(occurred_on) as d1, max(occurred_on) as d2 from point_events where source_type = 'match'),
led as (select status, count(*) as n, coalesce(sum(points), 0) as pts, min(event_date) as d1, max(event_date) as d2 from points_ledger where source_type = 'match' group by status),
-- 4. действующие начисления за матч по составу компонентов
act as (
  select l.id, l.event_date,
         (l.components ? 'result' or l.components ? 'base' or l.components ? 'goals' or jsonb_typeof(l.components -> 'best') = 'number') as old_shape,
         (l.components ->> 'model' = 'rating') as new_shape
    from points_ledger l where l.source_type = 'match' and l.status = 'active'
),
-- 5-6. матчи с результатом (не технические) и их сыгравшие
m as (
  select x.id, x.played_on, x.team, x.opponent,
         count(*) filter (where mp.played) as played_n,
         count(*) filter (where mp.played and nullif(to_jsonb(mp) ->> 'performance_rating', '') is null) as unrated_n,
         count(*) filter (where mp.played and mp.best) as best_n
    from matches x
    left join match_players mp on mp.match_id = x.id
   where x.goals_for is not null and x.goals_against is not null and not x.technical
   group by x.id, x.played_on, x.team, x.opponent
)
select '1. point_events (архив), source_type=match' as section, 'строк' as metric, n::text as value,
       'сумма баллов ' || pts || ', с ' || coalesce(d1::text, '-') || ' по ' || coalesce(d2::text, '-') as note from legacy
union all
select '2. points_ledger, source_type=match', 'строк всего', coalesce(sum(n), 0)::text, 'сумма баллов ' || coalesce(sum(pts), 0) from led
union all
select '3. points_ledger match по статусам', status, n::text, 'сумма баллов ' || pts || ', с ' || d1 || ' по ' || d2 from led
union all
select '4. действующие match: старые компоненты (base, goals, best, result)', 'строк', count(*) filter (where old_shape)::text, 'с датой после запуска: ' || count(*) filter (where old_shape and event_date >= (select d from launch)) from act
union all
select '4. действующие match: новая модель (rating)', 'строк', count(*) filter (where new_shape)::text, 'прочие формы: ' || count(*) filter (where not old_shape and not new_shape) from act
union all
select '5. матчи с результатом после запуска, без единой оценки у сыгравших', 'матчей', count(*)::text,
       coalesce((select string_agg(s.id::text || ' ' || s.played_on, '; ' order by s.played_on) from (select id, played_on from m where played_on >= (select d from launch) and played_n > 0 and unrated_n = played_n order by played_on limit 20) s), 'нет')
  from m where played_on >= (select d from launch) and played_n > 0 and unrated_n = played_n
union all
select '6. матчи с результатом после запуска: неполный состав оценок', 'матчей', count(*)::text,
       coalesce((select string_agg(s.id::text || ' ' || s.played_on, '; ' order by s.played_on) from (select id, played_on from m where played_on >= (select d from launch) and played_n > 0 and unrated_n > 0 and unrated_n < played_n order by played_on limit 20) s), 'нет')
  from m where played_on >= (select d from launch) and played_n > 0 and unrated_n > 0 and unrated_n < played_n
union all
select '6. матчи с результатом после запуска: сыгравшие есть, лучшего нет', 'матчей', count(*)::text,
       coalesce((select string_agg(s.id::text || ' ' || s.played_on, '; ' order by s.played_on) from (select id, played_on from m where played_on >= (select d from launch) and played_n > 0 and best_n = 0 order by played_on limit 20) s), 'нет')
  from m where played_on >= (select d from launch) and played_n > 0 and best_n = 0
union all
select '6. матчи с результатом после запуска: лучших больше одного', 'матчей', count(*)::text, 'индекс match_players_one_best этого не допускает; не ноль = нарушение' from m where played_on >= (select d from launch) and best_n > 1
union all
select '6. матчи с результатом после запуска: сыгравших нет', 'матчей', count(*)::text, 'баллов не будет, лучший не нужен' from m where played_on >= (select d from launch) and played_n = 0
union all
select '7. справка: матчи с результатом до запуска (старые правила, в новый рейтинг не входят)', 'матчей', count(*)::text, 'из них без оценок у сыгравших: ' || count(*) filter (where played_n > 0 and unrated_n = played_n) from m where played_on < (select d from launch)
order by 1, 2;
