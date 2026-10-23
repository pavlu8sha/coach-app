-- pgTAP: ограничение частоты входа.
begin;
create extension if not exists pgtap;
select plan(8);

select ok(rate_limit_hit('t:1', 3, 600), 'первое обращение разрешено');
select ok(rate_limit_hit('t:1', 3, 600), 'второе разрешено');
select ok(rate_limit_hit('t:1', 3, 600), 'третье разрешено (лимит 3)');
select ok(not rate_limit_hit('t:1', 3, 600), 'четвёртое в том же окне заблокировано');
select ok(rate_limit_hit('t:2', 3, 600), 'другой ключ считается отдельно');

update rate_limits set window_start = now() - interval '11 minutes' where key = 't:1';
select ok(rate_limit_hit('t:1', 3, 600), 'после окончания окна счёт начинается заново');
select is((select hits from rate_limits where key = 't:1'), 1, 'счётчик после сброса равен 1');

set local role authenticated;
select throws_ok($$select rate_limit_hit('t:3', 3, 600)$$, '42501', null, 'приложение (authenticated) не может вызвать функцию');

select * from finish();
rollback;
