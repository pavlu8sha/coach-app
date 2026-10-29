-- S-01: поиск ребёнка для привязки ограничен по частоте: не больше 30 поисков на пользователя за 10 минут.
-- Короткие запросы (меньше 3 символов) ничего не возвращают и в лимит не входят.
-- Клуб: в модели нет связи «пользователь → клуб» для родителя, который ещё не привязан к ребёнку. Пока клуб один,
-- ищем только в нём — первом по id, так же как set_points_start. Когда появится второй клуб, нужна связь пользователя с клубом
-- и фильтр по ней; до этого поиск второго клуба будет скрыт (см. PR).
create or replace function search_players_for_link(q text)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
declare t text := trim(coalesce(q, ''));
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(t) < 3 then return; end if;
  if not rate_limit_hit('link_search:' || current_user_id()::text, 30, 600) then
    raise exception 'search limit reached' using errcode = '54000';
  end if;
  t := replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.full_name, g.name
    from players p left join groups g on g.id = p.group_id
    where p.status = 'active'
      and p.club_id = (select c.id from clubs c order by c.id limit 1)
      and p.full_name ilike '%' || t || '%'
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null)
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $$;
