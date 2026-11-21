-- 0218 (docs/acceptance/parent-tg-username-2026-11-21.md): ник родителя в Telegram для кнопки «Написать в Telegram» у тренера и администратора.
-- Ссылка tg://user?id=<ID> у тренера не открывалась (родителя нет в его контактах), нужна ссылка на ник.
-- Ник пишет ТОЛЬКО Edge Function tg-auth (service_role) из проверенной по подписи initData; из приложения записи нет (RLS users: политика только на чтение).
-- Колонка users.telegram_username читается как и остальные поля users: сам пользователь и администратор (RLS users_self не меняется).
-- Тренер получает ник только через group_parent_usernames(g), которая берёт набор родителей из group_parents(g): то же согласие на контакт.
alter table users add column if not exists telegram_username text check (telegram_username is null or telegram_username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$');

create or replace function group_parent_usernames(g uuid) returns table (telegram_id bigint, username text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- проверку «администратор или тренер группы» и согласие на контакт делает group_parents(g)
  return query
  select distinct gp.telegram_id, u.telegram_username
    from group_parents(g) gp
    join users u on u.telegram_id = gp.telegram_id
   where u.telegram_username is not null;
end $$;

revoke execute on function group_parent_usernames(uuid) from public, anon;
grant execute on function group_parent_usernames(uuid) to authenticated;
