-- 0022: выбранная роль при первом входе (родитель, тренер, ребёнок, гость).
-- Это только подсказка для интерфейса: права дают is_admin, coach_groups и player_guardians, а не это поле.
-- Тренер, выбрав роль, попадает в список заявок: группы ему назначает администратор.
alter table users add column chosen_role text check (chosen_role in ('parent', 'coach', 'child', 'guest'));

-- Менять своё поле пользователь может только через функцию: прямой записи в users у него нет.
create or replace function set_my_role(r text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if r not in ('parent', 'coach', 'child', 'guest') then raise exception 'bad role' using errcode = '22023'; end if;
  update users set chosen_role = r where id = current_user_id();
end $$;

revoke execute on function set_my_role(text) from public, anon;
grant execute on function set_my_role(text) to authenticated;
