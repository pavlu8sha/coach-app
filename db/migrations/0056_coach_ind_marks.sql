-- Индивидуальные и вратарские занятия: тренер отмечает посещение (как в старом приложении), не видя денег.
-- До этого ind_set_attended и таблицы занятий были доступны только администратору (0034), поэтому у тренера вкладка индивидуальных в «Занятиях» отвечала «forbidden».
-- ind_roster_list отдаёт тренеру только время, тему, тип, имена записавшихся и отметку посещения: без сумм и оплаты.
-- Отметка посещения доступна администратору и любому тренеру; тренер не может отметить занятие, которое ещё не началось (по Тбилиси), администратор — может.
create or replace function ind_roster_list(d_from date, d_to date)
returns table (session_id uuid, starts_at timestamp, topic text, goalkeepers boolean, player_id uuid, full_name text, attended boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d_from is null or d_to is null or d_to < d_from then raise exception 'bad period' using errcode = '22023'; end if;
  if d_to - d_from > 120 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select s.id, s.starts_at, s.topic, s.goalkeepers, b.player_id, p.full_name, b.attended
  from individual_sessions s
  left join individual_bookings b on b.session_id = s.id
  left join players p on p.id = b.player_id
  where s.starts_at >= d_from::timestamp and s.starts_at < (d_to + 1)::timestamp
  order by s.starts_at desc, p.full_name;
end $$;
revoke execute on function ind_roster_list(date, date) from public, anon;
grant execute on function ind_roster_list(date, date) to authenticated;

create or replace function ind_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp;
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select starts_at into st from individual_sessions where id = s;
  if st is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if not is_admin() and st > (now() at time zone 'Asia/Tbilisi') then raise exception 'date in the future' using errcode = '22023'; end if;
  update individual_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;
