-- 0215 (docs/acceptance/my-children-2026-11-20.md): серверный список детей родителя my_children().
-- Клиент собирал список по полю отзыва старой модели в player_guardians, сервер решает доступ через parent_access_ok() (0173):
-- в режимах test и all условия расходятся. Теперь список строится тем же предикатом, что RLS (is_guardian_of).
-- Только чтение: parent_access_ok, is_guardian_of, RLS и таблицы не меняются, существующие функции не пересоздаются.
-- Без фильтра по статусу игрока (как на клиенте: «Занимается» проверяет booking_signup).
create or replace function my_children() returns table (player_id uuid, full_name text, group_id uuid, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name, p.group_id, gr.name
    from player_guardians g
    join players p on p.id = g.player_id
    left join groups gr on gr.id = p.group_id
   where g.user_id = current_user_id() and parent_access_ok(g.user_id, g.player_id)
   order by p.full_name, p.id;
end $$;
revoke execute on function my_children() from public, anon;
grant execute on function my_children() to authenticated;
