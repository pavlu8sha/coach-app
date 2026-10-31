-- 0089 (issue #299): клуб пользователя. Нужен, чтобы поиск ребёнка для привязки (search_players_for_link) работал
-- в клубе родителя ещё до привязки, когда клубов станет больше одного.
-- users.club_id: nullable. Пользователь сам его менять не может (политики на update у users нет).
-- Заполнение: по привязанным детям (guardian), по группам тренера, затем у остальных (админ и пр.) остаётся null.
-- Для пользователя без клуба поиск использует первый клуб по id, как раньше (пока клуб один, поведение не меняется).
alter table users add column if not exists club_id uuid references clubs(id);

update users u set club_id = x.club_id
from (
  select g.user_id, (array_agg(p.club_id order by p.club_id))[1] as club_id
  from player_guardians g join players p on p.id = g.player_id group by g.user_id
) x
where u.id = x.user_id and u.club_id is null;

update users u set club_id = x.club_id
from (
  select cg.user_id, (array_agg(gr.club_id order by gr.club_id))[1] as club_id
  from coach_groups cg join groups gr on gr.id = cg.group_id group by cg.user_id
) x
where u.id = x.user_id and u.club_id is null;

create or replace function search_players_for_link(q text)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql volatile security definer set search_path = public as $$
declare t text := trim(coalesce(q, ''));
  my_club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(t) < 3 then return; end if;
  if not rate_limit_hit('link_search:' || current_user_id()::text, 30, 600) then
    raise exception 'search limit reached' using errcode = '54000';
  end if;
  select coalesce(u.club_id, (select c.id from clubs c order by c.id limit 1)) into my_club from users u where u.id = current_user_id();
  t := replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.full_name, g.name
    from players p left join groups g on g.id = p.group_id
    where p.status = 'active'
      and p.club_id = my_club
      and p.full_name ilike '%' || t || '%'
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null)
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $$;
