-- Откат 0213 (#714). Возвращает finish_notification из 0026 без claim_token и удаляет renew_notifications.
-- После отката новый tg-notify не сможет завершать уведомления: вместе с откатом нужен откат функции tg-notify
-- к версии до #714. Выполнять в SQL Editor целиком только при необходимости.
begin;

drop function if exists finish_notification(uuid, boolean, text, boolean, uuid);
drop function if exists renew_notifications(uuid, uuid);

create or replace function finish_notification(i uuid, ok boolean, err text, give_up boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if ok then
    update notifications set state = 'sent', sent_at = now(), last_error = null where id = i;
  else
    update notifications set last_error = left(err, 300), state = case when give_up or attempts >= 3 then 'failed' else 'pending' end where id = i;
  end if;
end $$;
revoke execute on function finish_notification(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function finish_notification(uuid, boolean, text, boolean) to service_role;

commit;
