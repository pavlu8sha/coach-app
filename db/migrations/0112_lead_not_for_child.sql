-- 0112 (#235): заявку на пробную тренировку отправляет взрослый, ребёнок не может.
-- Продолжение 0044 (замечание S-14: функцию мог вызвать любой вошедший, включая роль «ребёнок»).
-- Меняется только проверка роли в lead_submit_app: ребёнок (выбранная роль или привязка по коду) получает 'forbidden'.
-- Остальное (согласие, лимит 3 в сутки, защита от дублей, уведомление администратору) без изменений.
create or replace function lead_submit_app(parent text, child text, byear int, phone text, wish text, consent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := current_user_id(); tg bigint; r uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from users where id = uid and chosen_role = 'child')
     or exists (select 1 from child_links where user_id = uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce(consent, false) then raise exception 'consent required' using errcode = '22023'; end if;
  select telegram_id into tg from users where id = uid;
  r := lead_submit(tg, parent, null, child, byear, phone);
  update trials set source = 'app', note = left(nullif(trim(wish), ''), 300) where id = r and source = 'bot' and note is null;
  return r;
end $$;
revoke execute on function lead_submit_app(text, text, int, text, text, boolean) from public, anon;
grant execute on function lead_submit_app(text, text, int, text, text, boolean) to authenticated;
