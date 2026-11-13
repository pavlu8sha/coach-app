-- 0184 (REL-02, аудит 11.11): очередь уведомлений не зависает. Условия приёмки: docs/NOTIFICATIONS_QUEUE_ACCEPTANCE.md.
-- Было: строка, выданная три раза без finish_notification (429 прервал пачку, функция упала), навсегда оставалась pending
-- с attempts = 3 и больше не выдавалась и не закрывалась.
-- Стало:
--  * claim_notifications перед выдачей закрывает такие строки: state = failed, last_error = 'stalled[: прежняя ошибка]'.
--    Строка, выданная меньше 2 минут назад, не трогается (отправка может ещё идти). Остальное тело взято из 0176 без изменений
--    (проверка согласия, порядок, лимит 50, удаление sent старше 30 дней).
--  * release_notifications(ids, token): tg-notify возвращает выданные, но не обработанные строки (после 429): attempts - 1,
--    claimed_at = null. Каждая выдача помечает строки своим токеном (notifications.claim_token, возвращается claim_notifications),
--    release снимает только строки со своим токеном: старый запуск не может снять более новую выдачу другого запуска
--    (замечание к PR #623). Тип результата claim_notifications меняется (добавлен claim_token), поэтому функция пересоздаётся.
-- Тело claim_notifications сверено с master 8f2d2d3 (0176); при слиянии с другой миграцией, меняющей claim_notifications,
-- пересобрать тело (CLAUDE.md, урок 2026-11-11).
begin;

alter table notifications add column if not exists claim_token uuid;

drop function claim_notifications(int);
create function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text, buttons jsonb, claim_token uuid)
language plpgsql security definer set search_path = public as $$
declare r record; ok boolean; pass uuid[] := '{}'; tk uuid := gen_random_uuid();
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  -- 0184: три выдачи без ответа отправителя; повторять нельзя (Telegram мог принять сообщение), держать pending бессмысленно
  update notifications x set state = 'failed', last_error = 'stalled' || coalesce(': ' || x.last_error, '')
   where x.state = 'pending' and x.attempts >= 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes');
  for r in
    select x.id as nid, x.user_id as uid, x.player_ids as pids from notifications x
     where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
     order by (x.kind like 'camp\_broadcast\_%'), x.created_at limit greatest(1, least(n, 50)) for update skip locked
  loop
    if r.pids is null then pass := pass || r.nid; continue; end if;
    begin
      -- пустой список и неопределённый результат считаются отсутствием согласия; любое false подавляет сообщение целиком
      ok := cardinality(r.pids) > 0
            and coalesce((select bool_and(coalesce(parent_access_ok(r.uid, p), false)) from unnest(r.pids) as p), false);
      if ok then
        pass := pass || r.nid;
      else
        update notifications set state = 'skipped', last_error = 'consent' where notifications.id = r.nid;
      end if;
    exception when others then
      -- проверка не подтверждена: строка не выдаётся; после трёх ошибок закрывается как failed
      update notifications set consent_check_attempts = consent_check_attempts + 1, last_error = 'consent_check_error',
             state = case when consent_check_attempts + 1 >= 3 then 'failed' else state end
       where notifications.id = r.nid;
    end;
  end loop;
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now(), claim_token = tk
     where nt.id = any (pass)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons, nt.claim_token;
end $$;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

-- Вернуть выданные, но не обработанные строки (tg-notify после 429): попытка не засчитывается, строка доступна сразу.
-- Только строки, которые всё ещё держит выдача с этим токеном; без токена ничего не делает.
create or replace function release_notifications(ids uuid[], token uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if token is null then return 0; end if;
  update notifications set attempts = greatest(attempts - 1, 0), claimed_at = null, claim_token = null
   where id = any (coalesce(ids, '{}')) and state = 'pending' and claimed_at is not null and claim_token = token;
  get diagnostics k = row_count;
  return k;
end $$;
revoke execute on function release_notifications(uuid[], uuid) from public, anon, authenticated;
grant execute on function release_notifications(uuid[], uuid) to service_role;

commit;
