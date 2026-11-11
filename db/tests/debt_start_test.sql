begin;
create extension if not exists pgtap;
select plan(3);

select is(debt_start(), date '2026-09-01', 'debt_start возвращает начало финансового сезона');
select ok(not has_function_privilege('authenticated', 'debt_start()', 'execute'), 'authenticated не должен выполнять служебную debt_start()');
select ok(not has_function_privilege('anon', 'debt_start()', 'execute'), 'anon не должен выполнять служебную debt_start()');

select * from finish();
rollback;
