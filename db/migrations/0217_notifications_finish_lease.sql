-- 0217 (#714): завершение уведомления привязано к текущей выдаче, а lease продлевается перед Telegram-запросом.
--
-- Модель:
--  * TTL закрепления остаётся 2 минуты. Это не единственная защита: tg-notify перед каждым вызовом Bot API
--    продлевает закрепление текущей строки через renew_notifications(id, claim_token).
--  * Один запрос к Telegram ограничен 15 секундами (AbortSignal.timeout); общий бюджет пачки — 90 секунд.
--    Перед отправкой строка продлевается, поэтому 15 секунд заведомо меньше 2-минутного TTL.
--    Необработанные строки при исчерпании бюджета возвращаются release_notifications без потери попытки.
--  * finish_notification принимает claim_token и меняет только pending-строку, которая всё ещё закреплена
--    этой выдачей. Старый worker с прежним токеном не может завершить или освободить чужую выдачу.
--  * release_notifications уже проверяет claim_token (0184) и остаётся без изменений.
--
-- Остаточный риск at-least-once: если Telegram принял сообщение, но ответ потерян/истёк timeout или finish
-- не дошёл до базы, строка останется pending и после истечения lease будет отправлена повторно. Без
-- идемпотентности на стороне Telegram это устранить нельзя; дубль возможен, бесконечного повтора нет
-- (attempts < 3, затем stalled/failed).
--
-- Совместимость: функция finish_notification с четырьмя аргументами удаляется. Без токена завершение
-- запрещено, поэтому старый tg-notify после миграции не сможет менять очередь. Миграцию и новую версию
-- tg-notify применять вместе, в окно без активной отправки (остановить cron, дождаться пустой/недолгой
-- очереди). Само применение не входит в этот PR.
begin;

-- Продлить закрепление строки, только если она всё ещё принадлежит этой выдаче.
-- Возвращает true, если строка закреплена за токеном; false — выдача потеряна или строка уже не pending.
create or replace function renew_notifications(i uuid, token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if i is null or token is null then return false; end if;
  update notifications set claimed_at = now()
   where id = i and state = 'pending' and claimed_at is not null and claim_token = token;
  return found;
end $$;
revoke execute on function renew_notifications(uuid, uuid) from public, anon, authenticated;
grant execute on function renew_notifications(uuid, uuid) to service_role;

-- Итог отправки. Только владелец текущей выдачи (claim_token) может изменить строку.
drop function if exists finish_notification(uuid, boolean, text, boolean);
create function finish_notification(i uuid, ok boolean, err text, give_up boolean, token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if i is null or token is null then return false; end if;
  if ok then
    update notifications set state = 'sent', sent_at = now(), last_error = null
     where id = i and state = 'pending' and claimed_at is not null and claim_token = token;
  else
    update notifications set last_error = left(err, 300),
           state = case when give_up or attempts >= 3 then 'failed' else 'pending' end
     where id = i and state = 'pending' and claimed_at is not null and claim_token = token;
  end if;
  get diagnostics k = row_count;
  return k > 0;
end $$;
revoke execute on function finish_notification(uuid, boolean, text, boolean, uuid) from public, anon, authenticated;
grant execute on function finish_notification(uuid, boolean, text, boolean, uuid) to service_role;

commit;
