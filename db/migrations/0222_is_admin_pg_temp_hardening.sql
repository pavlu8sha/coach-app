-- 0222: harden public.is_admin() against temporary-relation shadowing.
--
-- pg_temp is explicitly placed last in the function-local search_path. Trusted
-- relations and helper functions are schema-qualified as defense in depth.
-- Existing EXECUTE grants and function ownership are intentionally preserved.

create or replace function public.is_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users
    where id = public.current_user_id() and is_admin
  )
$$;
