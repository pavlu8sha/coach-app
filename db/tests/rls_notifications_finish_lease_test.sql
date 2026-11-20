-- pgTAP (Issue #714, миграция 0209): finish_notification принадлежит только текущей выдаче,
-- renew_notifications продлевает lease только владельцу. Только синтетические данные.
begin;
create extension if not exists pgtap;
select plan(37);

insert into users (id, telegram_id, display_name, is_admin)
values ('00000000-0000-0000-0000-00000000f714', 8714, 'Синтетик lease', true);

create or replace function as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create function q(lbl text) returns uuid language sql as $$
  insert into notifications (user_id, kind, text)
  values ('00000000-0000-0000-0000-00000000f714', 'syn_lease', lbl)
  returning id
$$;
create temp table last_claim (text text, claim_token uuid);
grant all on last_claim to service_role;
create function cl(n int default 50) returns text[] language plpgsql as $$
declare r text[];
begin
  delete from last_claim;
  perform as_service();
  insert into last_claim select c.text, c.claim_token from claim_notifications(n) c;
  reset role;
  select coalesce(array_agg(c.text order by c.text), '{}') into r from last_claim c;
  return r;
end $$;
create function last_tok() returns uuid language sql as $$ select claim_token from last_claim limit 1 $$;
create function row_of(lbl text) returns notifications language sql as $$ select * from notifications where text = lbl $$;
create function age_claims(lbl text) returns void language sql as $$
  update notifications set claimed_at = now() - interval '5 minutes' where text = lbl and claimed_at is not null
$$;
create function fin(i uuid, t uuid, ok boolean, err text default null, give_up boolean default false) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform as_service();
  r := finish_notification(i, ok, err, give_up, t);
  reset role;
  return r;
end $$;
create function ren(i uuid, t uuid) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform as_service();
  r := renew_notifications(i, t);
  reset role;
  return r;
end $$;
create function rel(ids uuid[], t uuid) returns int language plpgsql as $$
declare r int;
begin
  perform as_service();
  r := release_notifications(ids, t);
  reset role;
  return r;
end $$;

-- ===== stale finish: A потерял lease, B забрал строку, A не может её завершить =====
select q('F1');
select is(cl(), array['F1'], 'F1. A получил строку');
create temp table f1_a as select last_tok() as t;
select age_claims('F1');
select is(cl(), array['F1'], 'F1. после истечения lease B забрал строку');
create temp table f1_b as select last_tok() as t;
select isnt((select t from f1_a), (select t from f1_b), 'F1. у A и B разные токены');
select is(fin((row_of('F1')).id, (select t from f1_a), true, null), false, 'F1. finish A со старым токеном не применён');
select is((row_of('F1')).state, 'pending', 'F1. состояние осталось pending');
select is((row_of('F1')).attempts, 2, 'F1. попытки B не изменены');
select is((row_of('F1')).claim_token, (select t from f1_b), 'F1. токен остался у B');
select is(fin((row_of('F1')).id, (select t from f1_b), true, null), true, 'F1. finish B с текущим токеном применён');
select is((row_of('F1')).state, 'sent', 'F1. B завершил строку');
select is(fin((row_of('F1')).id, (select t from f1_a), true, null), false, 'F1. повторный stale finish ничего не меняет');

-- ===== stale release: то же для release после повторной выдачи =====
select q('F2');
select is(cl(), array['F2'], 'F2. A получил строку');
create temp table f2_a as select last_tok() as t;
select age_claims('F2');
select is(cl(), array['F2'], 'F2. B забрал строку после истечения lease');
create temp table f2_b as select last_tok() as t;
select is(rel(array[(row_of('F2')).id], (select t from f2_a)), 0, 'F2. release A со старым токеном ничего не возвращает');
select is((row_of('F2')).claim_token, (select t from f2_b), 'F2. выдача B не изменена');
select is(fin((row_of('F2')).id, (select t from f2_b), true, null), true, 'F2. B завершил строку');

-- ===== renew: продлевает только текущую выдачу и восстанавливает lease, если строку ещё не забрали =====
select q('F3');
select is(cl(), array['F3'], 'F3. A получил строку');
create temp table f3_a as select last_tok() as t;
select age_claims('F3');
select is((row_of('F3')).claimed_at < now() - interval '4 minutes', true, 'F3. lease истёк');
select is(ren((row_of('F3')).id, (select t from f3_a)), true, 'F3. владелец A продлил lease после истечения');
select is(cl(), '{}'::text[], 'F3. после продления B не получает строку');
select is((row_of('F3')).claimed_at > now() - interval '10 seconds', true, 'F3. claimed_at обновлён');
select age_claims('F3');
select is(cl(), array['F3'], 'F3. после повторного истечения B забрал строку');
create temp table f3_b as select last_tok() as t;
select is(ren((row_of('F3')).id, (select t from f3_a)), false, 'F3. renew A после выдачи B не применён');
select is((row_of('F3')).claim_token, (select t from f3_b), 'F3. токен остался у B');
select is(fin((row_of('F3')).id, (select t from f3_b), true, null), true, 'F3. B завершил строку');

-- ===== без токена и с чужим токеном завершение запрещено =====
select q('F4');
select is(cl(), array['F4'], 'F4. A получил строку');
create temp table f4_a as select last_tok() as t;
select is(fin((row_of('F4')).id, null, true, null), false, 'F4. finish без токена запрещён');
select is(fin((row_of('F4')).id, gen_random_uuid(), true, null), false, 'F4. finish с чужим токеном запрещён');
select is((row_of('F4')).state, 'pending', 'F4. состояние не изменилось');
select is(fin((row_of('F4')).id, (select t from f4_a), true, null), true, 'F4. владелец завершил строку');

-- ===== права и совместимость сигнатуры =====
select is(to_regprocedure('public.finish_notification(uuid,boolean,text,boolean)') is null, true,
  '0209. старая 4-аргументная finish_notification удалена');
select is(has_function_privilege('anon', 'finish_notification(uuid,boolean,text,boolean,uuid)', 'execute'), false,
  '0209. anon не завершает уведомления');
select is(has_function_privilege('authenticated', 'finish_notification(uuid,boolean,text,boolean,uuid)', 'execute'), false,
  '0209. authenticated не завершает уведомления');
select is(has_function_privilege('anon', 'renew_notifications(uuid,uuid)', 'execute'), false,
  '0209. anon не продлевает lease');
select is(has_function_privilege('authenticated', 'renew_notifications(uuid,uuid)', 'execute'), false,
  '0209. authenticated не продлевает lease');
select is(has_function_privilege('service_role', 'finish_notification(uuid,boolean,text,boolean,uuid)', 'execute'), true,
  '0209. service_role завершает уведомления');
select is(has_function_privilege('service_role', 'renew_notifications(uuid,uuid)', 'execute'), true,
  '0209. service_role продлевает lease');
select is((select p.prosecdef and p.proconfig @> array['search_path=public'] from pg_proc p
            where p.oid = 'renew_notifications(uuid,uuid)'::regprocedure), true,
  '0209. renew_notifications: security definer с закреплённым search_path');

select * from finish();
rollback;
