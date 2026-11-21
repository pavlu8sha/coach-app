-- Откат 0212: возвращает тело set_my_role из 0022 (без проверки числа строк и явной проверки NULL). Права те же.
create or replace function set_my_role(r text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if r not in ('parent', 'coach', 'child', 'guest') then raise exception 'bad role' using errcode = '22023'; end if;
  update users set chosen_role = r where id = current_user_id();
end $$;

revoke execute on function set_my_role(text) from public, anon;
grant execute on function set_my_role(text) to authenticated;
