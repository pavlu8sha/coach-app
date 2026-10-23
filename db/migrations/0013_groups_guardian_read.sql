-- Родитель видит название группы, в которой играет его ребёнок (раньше группы читали только администратор и тренер группы).
-- Через security definer, чтобы политика не зависела от RLS таблиц players и player_guardians. Отозванное согласие доступа не даёт.
create or replace function is_guardian_in_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players pl
    join player_guardians pg on pg.player_id = pl.id
    where pl.group_id = g and pg.user_id = current_user_id() and pg.consent_revoked_at is null
  )
$$;

drop policy if exists groups_read on groups;
create policy groups_read on groups for select
  using (is_admin() or is_coach_of_group(id) or is_guardian_in_group(id));

grant execute on function is_guardian_in_group(uuid) to authenticated;
