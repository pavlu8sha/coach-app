-- pgTAP: match_stats существует в единственной версии, вызов без p_cat однозначен (0081).
begin;
create extension if not exists pgtap;
select plan(2);
select is((select count(*)::int from pg_proc where proname = 'match_stats' and pronamespace = 'public'::regnamespace), 1, 'одна функция match_stats');
select ok(to_regprocedure('match_stats(date,date)') is null, 'старой версии без p_cat нет');
select * from finish();
rollback;
