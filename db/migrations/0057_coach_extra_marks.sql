-- Дополнительные тренировки: тренер отмечает посещение (как в старом приложении, раздел «Отметки»), не видя денег.
-- Как для индивидуальных (0056): extra_roster_list отдаёт администратору и тренеру только дату, место, имена записавшихся и посещение, без сумм и оплаты;
-- extra_set_attended доступна тренеру, но он не отмечает тренировку, которая ещё не состоялась (по Тбилиси); администратор — может.
create or replace function extra_roster_list(d_from date, d_to date)
returns table (session_id uuid, starts_on date, place text, player_id uuid, full_name text, attended boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d_from is null or d_to is null or d_to < d_from then raise exception 'bad period' using errcode = '22023'; end if;
  if d_to - d_from > 120 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select s.id, s.starts_on, s.place, b.player_id, p.full_name, b.attended
  from extra_sessions s
  left join extra_bookings b on b.session_id = s.id
  left join players p on p.id = b.player_id
  where s.starts_on between d_from and d_to
  order by s.starts_on desc, p.full_name;
end $$;
revoke execute on function extra_roster_list(date, date) from public, anon;
grant execute on function extra_roster_list(date, date) to authenticated;

create or replace function extra_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select starts_on into d from extra_sessions where id = s;
  if d is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if not is_admin() and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  update extra_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;
