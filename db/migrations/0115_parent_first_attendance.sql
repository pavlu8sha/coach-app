-- 0115: first attendance month for a parent's actively linked child.
-- Parents cannot read `sessions` (RLS), so the calendar lower bound is served by this RPC.
create or replace function parent_first_attendance(p_player uuid)
returns date
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := current_user_id();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_player is null then raise exception 'invalid player' using errcode = '22023'; end if;
  if not exists (
    select 1 from player_guardians pg
    where pg.player_id = p_player and pg.user_id = me and pg.consent_revoked_at is null
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  return (
    select min((s.starts_at at time zone 'Asia/Tbilisi')::date)
    from attendance a join sessions s on s.id = a.session_id
    where a.player_id = p_player
  );
end $$;

revoke execute on function parent_first_attendance(uuid) from public, anon;
grant execute on function parent_first_attendance(uuid) to authenticated;
