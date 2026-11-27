-- pgTAP: откат 0231 (db/ops/rollback-0231-camp-refund-idempotency.sql) не возвращает небезопасную конфигурацию и не теряет возвраты (#721).
-- Всё выполняется в транзакции и откатывается; после отката миграция применяется повторно (проверка повторного применения).
\set pf `cat db/ops/preflight.sql`
begin;
create extension if not exists pgtap;
select plan(18);
create temp view pf as :pf;

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 7231, 'Админ', true);
insert into camps (id, club_id, name, location, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Сбор', 'Исани', '2099-01-03', '2099-01-10');
insert into camp_tariffs (id, camp_id, name, price, active) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Тариф', 1000, true);
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'g', camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость', null, '00000000-0000-0000-0000-0000000000e1', null, null, null);
select camp_pay((select id from ids where k = 'g'), 1000, 'payment', current_date, 'Наличные', null);
select camp_refund((select id from ids where k = 'g'), 300, current_date, 'до отката', '00000000-0000-0000-0000-000000000701');
reset role;

\i db/ops/rollback-0231-camp-refund-idempotency.sql

select is((select count(*)::int from pg_proc where proname = 'camp_refund' and pronamespace = 'public'::regnamespace), 1, 'после отката одна функция camp_refund');
select ok(to_regprocedure('public.camp_refund(uuid,numeric,date,text)') is not null and to_regprocedure('public.camp_refund(uuid,numeric,date,text,uuid)') is null, 'после отката: прежняя четырёхаргументная сигнатура');
select ok((select p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = to_regprocedure('public.camp_refund(uuid,numeric,date,text)')), 'откат не возвращает небезопасный search_path (security definer, public, pg_temp)');
select ok(has_function_privilege('authenticated', 'camp_refund(uuid,numeric,date,text)', 'execute') and not has_function_privilege('anon', 'camp_refund(uuid,numeric,date,text)', 'execute'), 'после отката: authenticated выполняет, anon нет');
select hasnt_column('camp_payments', 'request_id', 'после отката столбца request_id нет');
select is((select count(*)::int from camp_payments where kind = 'refund'), 1, 'возврат, записанный до отката, сохранён');
select is((select sum(amount) from camp_payments where participant_id = (select id from ids where k = 'g')), 700.00::numeric, 'сумма оплаченного не изменилась (700)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_refund((select id from ids where k = 'g'), 100, current_date, 'после отката')$$, 'прежняя четырёхаргументная функция работает');
select throws_ok($$select camp_refund((select id from ids where k = 'g'), 700, current_date, null)$$, '22023', 'refund above paid', 'после отката правило «не больше оплаченного» работает');
reset role;

\i db/migrations/0231_camp_refund_idempotency.sql

select ok(to_regprocedure('public.camp_refund(uuid,numeric,date,text,uuid)') is not null and to_regprocedure('public.camp_refund(uuid,numeric,date,text)') is null, 'повторное применение 0231 после отката: новая сигнатура');
select ok((select p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = to_regprocedure('public.camp_refund(uuid,numeric,date,text,uuid)')), 'повторное применение: security definer, public, pg_temp');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((camp_refund((select id from ids where k = 'g'), 100, current_date, 'после повторного применения', '00000000-0000-0000-0000-000000000702')->>'duplicate')::boolean, false, 'повторное применение: возврат с ключом работает');
select is((camp_refund((select id from ids where k = 'g'), 100, current_date, 'после повторного применения', '00000000-0000-0000-0000-000000000702')->>'duplicate')::boolean, true, 'повторное применение: повтор с тем же ключом = duplicate');

-- preflight 0231 различает безопасную и небезопасную установку (prosecdef, proconfig, grants anon/authenticated)
reset role;
select is((select status from pf where migration = '0231_camp_refund_idempotency'), 'APPLIED', 'preflight 0231: безопасная установка = APPLIED');
alter function camp_refund(uuid, numeric, date, text, uuid) set search_path = public;
select isnt((select status from pf where migration = '0231_camp_refund_idempotency'), 'APPLIED', 'preflight 0231: search_path без pg_temp не считается установленным');
alter function camp_refund(uuid, numeric, date, text, uuid) set search_path = public, pg_temp;
alter function camp_refund(uuid, numeric, date, text, uuid) security invoker;
select isnt((select status from pf where migration = '0231_camp_refund_idempotency'), 'APPLIED', 'preflight 0231: security invoker не считается установленным');
alter function camp_refund(uuid, numeric, date, text, uuid) security definer;
grant execute on function camp_refund(uuid, numeric, date, text, uuid) to anon;
select isnt((select status from pf where migration = '0231_camp_refund_idempotency'), 'APPLIED', 'preflight 0231: EXECUTE у anon не считается установленным');
revoke execute on function camp_refund(uuid, numeric, date, text, uuid) from anon;
select is((select status from pf where migration = '0231_camp_refund_idempotency'), 'APPLIED', 'preflight 0231: после исправления снова APPLIED');

select * from finish();
rollback;
