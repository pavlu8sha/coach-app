-- Откат миграции 0184 (REL-02). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает claim_notifications из 0176 (тип результата без claim_token, без закрытия зависших строк), удаляет
-- release_notifications и столбец notifications.claim_token.
-- Строки, уже закрытые как failed с причиной stalled, остаются failed: их повторная отправка рискует дублем.
-- После отката tg-notify должна быть версии без вызова release_notifications (иначе в логе функции будет ошибка release, отправка не ломается).
begin;

drop function claim_notifications(int);
create function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text, buttons jsonb)
language plpgsql security definer set search_path = public as $$
declare r record; ok boolean; pass uuid[] := '{}';
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
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
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id = any (pass)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons;
end $$;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

drop function if exists release_notifications(uuid[], uuid);
alter table notifications drop column if exists claim_token;

commit;
