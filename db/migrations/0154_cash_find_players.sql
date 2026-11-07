-- 0154: поиск игрока в кассе только среди тех, у кого пользователь может принимать оплаты.
-- Раньше экран «Касса → Приём оплат» искал прямо в таблице players, а читать players могут все тренеры (0042).
-- Локальный админ, он же тренер (Гио), поэтому находил игроков чужих локаций (запись оплаты ему и так закрыта, 0085).
-- Теперь: глобальный админ ищет по всем игрокам; локальный админ — только по игрокам групп своих локаций;
-- остальным отказ. Игрок без группы (нет локации) виден только глобальному админу. Данные и права таблиц не меняются.
-- Откат: drop function cash_find_players(text); вернуть прямой запрос в CashDesk.tsx.

create or replace function cash_find_players(q text)
returns table (id uuid, full_name text, group_id uuid, external_id text, birth_date date, status text, group_name text)
language plpgsql stable security definer set search_path = public as $$
declare needle text := lower(trim(coalesce(q, '')));
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(needle) < 2 then return; end if;
  return query
  select p.id, p.full_name, p.group_id, p.external_id, p.birth_date, p.status, g.name
    from players p left join groups g on g.id = p.group_id
   where position(needle in lower(p.full_name)) > 0
     and (is_admin() or is_location_admin(g.location))
   order by p.full_name
   limit 10;
end $$;

revoke execute on function cash_find_players(text) from public, anon;
grant execute on function cash_find_players(text) to authenticated;
