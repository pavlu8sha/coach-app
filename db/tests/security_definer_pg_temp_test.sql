-- Reproduction/regression guard for SECURITY DEFINER relation shadowing via pg_temp.
-- The assertion on public.is_admin() is intentionally expected to fail until the
-- function's search_path is hardened. Run only in the isolated local/CI database.
begin;
create extension if not exists pgtap;
select plan(4);

select ok(
  has_database_privilege('authenticated', current_database(), 'TEMP'),
  'authenticated can create temporary relations in the test database'
);

-- A real non-admin user is the trusted baseline. The temp relation below will
-- contain the same id with is_admin=true.
insert into public.users (id, telegram_id, display_name, is_admin)
values (
  '81900000-0000-4000-8000-000000000001',
  819000000000001,
  'pg_temp security test',
  false
);

select is(
  (select u.is_admin from public.users u where u.id = '81900000-0000-4000-8000-000000000001'),
  false,
  'the real public.users row is not an administrator'
);

-- Simulate the application role and its JWT subject. Create the shadow relation
-- before the first call so SQL-function name resolution happens in this context.
set local role authenticated;
set local request.jwt.claim.sub = '81900000-0000-4000-8000-000000000001';

create temporary table users (
  id uuid primary key,
  is_admin boolean not null
);
insert into pg_temp.users (id, is_admin)
values ('81900000-0000-4000-8000-000000000001', true);

select ok(
  to_regclass('pg_temp.users') is not null,
  'authenticated created a same-named temporary relation'
);

select is(
  public.is_admin(),
  false,
  'is_admin ignores pg_temp.users and reads the trusted public.users relation'
);

reset role;
select * from finish();
rollback;
