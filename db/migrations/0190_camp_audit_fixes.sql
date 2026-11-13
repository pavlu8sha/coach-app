-- 0190 (Issue #470, аудит 11.11 C-03, C-04, C-05, C-09): три исправления без смены подписей функций. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (72-76).
--  * camp_broadcast_send (тело из 0187): защита от повтора сравнивает с текстом, как он записан в журнале (у напоминания есть префикс).
--  * camp_update_participant (тело из 0160): запись, отменённую родителем, нельзя вывести из cancelled устаревшей карточкой.
--  * camp_pay (тело из 0085): блокировка сбора, только статус registered, защита от двойного нажатия, дата по Тбилиси.
-- Требует 0187 (иначе её применение позже вернёт прежнее тело camp_broadcast_send). Данные не меняет, ничего не отправляет.
-- Откат: db/ops/rollback-0190-camp-audit-fixes.sql.
begin;

CREATE OR REPLACE FUNCTION public.camp_broadcast_send(cid uuid, k text, b text, expected integer, tok text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text := camp_broadcast_check(cid, k, b); stored text; c camps; n int; bid uuid := gen_random_uuid(); r record; nid uuid; list jsonb; cur text;
begin
  select * into c from camps where id = cid for update;
  if not camp_notify_enabled(c.club_id) then raise exception 'notifications off' using errcode = '22023'; end if;
  if expected is null then raise exception 'confirmation required' using errcode = '22023'; end if;
  -- сравнение с текстом так, как он записывается в журнал (у напоминания к тексту добавлена строка-префикс)
  stored := case when k = 'reminder' then 'Напоминание об оплате (остаток каждой семьи подставлен автоматически)' || case when t is not null then E'\n' || t else '' end else t end;
  if exists (select 1 from camp_broadcasts where camp_id = cid and kind = k and body is not distinct from stored and created_at > now() - interval '10 minutes') then
    raise exception 'duplicate broadcast' using errcode = '22023';
  end if;
  if (select count(*) from camp_broadcasts where camp_id = cid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many broadcasts' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('u', x.user_id, 'm', x.msg) order by x.user_id), '[]'::jsonb),
         md5(coalesce(string_agg(x.user_id::text || ':' || x.msg, '|' order by x.user_id), ''))
    into list, cur from camp_broadcast_targets(cid, k, t) x;
  n := jsonb_array_length(list);
  if n = 0 then raise exception 'no recipients' using errcode = '22023'; end if;
  -- подтверждается не только число, но и состав получателей с текстом каждому
  if n <> expected or tok is distinct from cur then raise exception 'recipients changed' using errcode = '22023'; end if;
  insert into camp_broadcasts (id, camp_id, kind, body, recipients, author_id, author_name)
  values (bid, cid, k, stored, n, current_user_id(), (select display_name from users where id = current_user_id()));
  for r in select (e ->> 'u')::uuid as user_id, e ->> 'm' as msg from jsonb_array_elements(list) e loop
    insert into notifications (user_id, kind, text, player_ids)
    values (r.user_id, 'camp_broadcast_' || k, r.msg,
            case when k = 'reminder' then camp_broadcast_player_ids(cid, r.user_id)
                 when k = 'participants' then camp_broadcast_participant_ids(cid, r.user_id) end) returning id into nid;
    insert into camp_broadcast_messages (broadcast_id, notification_id, user_id) values (bid, nid, r.user_id);
  end loop;
  return jsonb_build_object('id', bid, 'recipients', n);
end $function$;

create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid; old text;
begin
  perform camp_assert_admin();
  select camp_id, status into cid, old from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  perform 1 from camps where id = cid for update;
  select status into old from camp_participants where id = pid;
  -- «cancelled» (отмена родителем) админ не выставляет, но может править сумму и комментарий отменённой записи, оставляя статус
  if st is null or (st not in ('registered', 'declined') and not (st = 'cancelled' and old = 'cancelled')) then raise exception 'bad status' using errcode = '22023'; end if;
  -- C-04: устаревшая карточка (открыта до отмены родителем) не воскрешает отменённую запись; вернуть можно только записью заново
  if old = 'cancelled' and st <> 'cancelled' then raise exception 'cancelled by parent' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < (select coalesce(sum(amount), 0) from camp_payments where participant_id = pid) then raise exception 'amount below paid' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if st = 'registered' and old <> 'registered' then perform camp_assert_seat(cid); end if;
  perform set_config('camp.note', 'admin', true);
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
  perform set_config('camp.note', '', true);
end $$;

create or replace function camp_pay(pid uuid, amt numeric, k text, d date, mth text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; r uuid;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into cp from camp_participants where id = pid;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(camp_location(cp.camp_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k not in ('booking', 'payment') then raise exception 'bad kind' using errcode = '22023'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  -- C-05: тот же порядок блокировок, что у записи, отмены и возврата (сначала сбор), затем актуальные статус и сумма
  perform 1 from camps where id = cp.camp_id for update;
  select * into cp from camp_participants where id = pid;
  if cp.status <> 'registered' then raise exception 'not registered' using errcode = '22023'; end if;
  -- оплата сверх суммы участника допускается (решение владельца 13.11)
  if exists (select 1 from camp_payments where participant_id = pid and amount = amt and kind = k
                and method is not distinct from nullif(trim(mth), '') and paid_on = coalesce(d, (now() at time zone 'Asia/Tbilisi')::date)
                and created_at > now() - interval '60 seconds') then
    raise exception 'duplicate payment' using errcode = '22023';
  end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment)
  values (cp.camp_id, pid, cp.player_id, amt, coalesce(d, (now() at time zone 'Asia/Tbilisi')::date), k, nullif(trim(mth), ''), nullif(trim(cmt), ''))
  returning id into r;
  return r;
end $$;

revoke execute on function camp_update_participant(uuid, uuid, numeric, text, text, text), camp_pay(uuid, numeric, text, date, text, text) from public, anon, service_role;
grant execute on function camp_update_participant(uuid, uuid, numeric, text, text, text), camp_pay(uuid, numeric, text, date, text, text) to authenticated;
revoke execute on function camp_broadcast_send(uuid, text, text, int, text) from public, anon, service_role;
grant execute on function camp_broadcast_send(uuid, text, text, int, text) to authenticated;

commit;
