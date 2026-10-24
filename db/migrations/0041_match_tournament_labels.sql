-- Название и тип турнира для матчей, которые пользователь и так видит (фильтр «Турнир» на экране «Матчи»).
-- Таблица tournaments закрыта для всех, кроме администратора (там взносы), поэтому отдаём только название и тип.
-- Функция работает с правами вызывающего: список матчей ограничен политикой matches_read, турнир берётся через узкую функцию.
create or replace function tournament_label(tid uuid) returns table (name text, kind text)
language sql stable security definer set search_path = public as $$
  select t.name, t.kind from tournaments t where t.id = tid and auth.uid() is not null
$$;
revoke execute on function tournament_label(uuid) from public, anon;
grant execute on function tournament_label(uuid) to authenticated;

create or replace function match_tournaments() returns table (match_id uuid, tournament_id uuid, tournament_name text, tournament_kind text, match_kind text)
language sql stable set search_path = public as $$
  select m.id, m.tournament_id, l.name, l.kind, m.kind
  from matches m
  left join lateral tournament_label(m.tournament_id) l on m.tournament_id is not null
$$;
revoke execute on function match_tournaments() from public, anon;
grant execute on function match_tournaments() to authenticated;
