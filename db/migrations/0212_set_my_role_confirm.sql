-- 0212: set_my_role не сообщает об успехе, если роль не сохранена (#704).
-- Было (0022): `update users ... where id = current_user_id()` без проверки числа затронутых строк; при отсутствии строки users функция
-- завершалась успешно, NULL проходил мимо проверки допустимых значений вхолостую. Теперь:
--   NULL и недопустимая роль → 22023 (bad role); нет авторизации → 42501 (forbidden); нет строки users → P0002 (profile_missing).
-- Профиль из SQL не создаётся: его создаёт вход (Edge Function tg-auth). Роль по-прежнему только подсказка интерфейса, права не меняются.
-- Тело взято из 0022 (единственное определение: grep -lEi "function +(public\.)?set_my_role *\(" db/migrations/*.sql).
create or replace function set_my_role(r text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if r is null or r not in ('parent', 'coach', 'child', 'guest') then raise exception 'bad role' using errcode = '22023'; end if;
  update users set chosen_role = r where id = current_user_id();
  if not found then raise exception 'profile_missing' using errcode = 'P0002'; end if;
end $$;

revoke execute on function set_my_role(text) from public, anon;
grant execute on function set_my_role(text) to authenticated;
