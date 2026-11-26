-- Regression guard for SECURITY DEFINER relation shadowing via pg_temp.
-- Runs only in the isolated local/CI database.
begin;
create extension if not exists pgtap;
select plan(8);

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

-- Positive control: a real administrator. The shadow table below claims this
-- user is NOT an administrator, so a true result proves public.users is read.
insert into public.users (id, telegram_id, display_name, is_admin)
values (
  '81900000-0000-4000-8000-000000000002',
  819000000000002,
  'pg_temp security test admin',
  true
);

select is(
  (select u.is_admin from public.users u where u.id = '81900000-0000-4000-8000-000000000002'),
  true,
  'the real public.users admin row has is_admin=true'
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
values ('81900000-0000-4000-8000-000000000001', true),
       ('81900000-0000-4000-8000-000000000002', false);

select ok(
  to_regclass('pg_temp.users') is not null,
  'authenticated created a same-named temporary relation'
);

select is(
  public.is_admin(),
  false,
  'is_admin ignores pg_temp.users and reads the trusted public.users relation'
);

-- Positive control under the same shadow: the real admin is still recognised.
set local request.jwt.claim.sub = '81900000-0000-4000-8000-000000000002';
select is(
  public.is_admin(),
  true,
  'a real administrator gets true even though pg_temp.users says is_admin=false'
);

-- Negative control: no JWT subject at all.
set local request.jwt.claim.sub = '';
select is(
  public.is_admin(),
  false,
  'authenticated without a JWT subject gets false'
);

-- Negative control: anon (no subject, as for a real anonymous request). Either a clean false or a privilege error is safe;
-- true is the only failure. Grants are deliberately not changed here.
reset role;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
begin
  perform set_config('test.anon_is_admin', public.is_admin()::text, true);
exception when insufficient_privilege then
  perform set_config('test.anon_is_admin', 'denied', true);
end $$;
reset role;
select ok(
  current_setting('test.anon_is_admin') in ('false', 'denied'),
  'anon never gets true from is_admin (got ' || current_setting('test.anon_is_admin') || ')'
);

select * from finish();
rollback;
