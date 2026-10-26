-- 0047: запись на индивидуальные и вратарские только вручную, на каждое занятие отдельно.
-- Раньше ind_create_session записывала на новое занятие всех «постоянных» этого типа (0034), и такие игроки
-- попадали в каждое занятие и получали долг. Теперь занятие создаётся пустым. Таблица individual_regulars остаётся, но не используется.
create or replace function ind_create_session(d date, t time, gk boolean, theme text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; ext text;
begin
  perform ind_assert_admin();
  if d is null or t is null then raise exception 'date required' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when gk then '-GK' else '' end;
  if exists (select 1 from individual_sessions where club_id = c and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers)
  values (c, ext, (d + t), nullif(trim(theme), ''), coalesce(gk, false)) returning id into sid;
  return sid;
end $$;
revoke execute on function ind_create_session(date, time, boolean, text) from public, anon;
grant execute on function ind_create_session(date, time, boolean, text) to authenticated;
