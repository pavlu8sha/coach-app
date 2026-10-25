-- Заявка «Записаться на пробную» из приложения (гость, родитель без привязки): та же заявка trials, что из бота (0039),
-- но от вошедшего пользователя. Лимит, проверки и уведомление администратору — как в lead_submit; источник 'app'.
-- Согласие на обработку данных подтверждается галочкой в форме (consent обязателен), дата фиксируется в trials.consent_at.
create or replace function lead_submit_app(parent text, child text, byear int, phone text, wish text, consent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := current_user_id(); tg bigint; uname text; r uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not coalesce(consent, false) then raise exception 'consent required' using errcode = '22023'; end if;
  select telegram_id into tg from users where id = uid;
  r := lead_submit(tg, parent, null, child, byear, phone);
  update trials set source = 'app', note = left(nullif(trim(wish), ''), 300) where id = r and source = 'bot' and note is null;
  return r;
end $$;
revoke execute on function lead_submit_app(text, text, int, text, text, boolean) from public, anon;
grant execute on function lead_submit_app(text, text, int, text, text, boolean) to authenticated;
