-- 0166 (Issue #470, этап 3): правка записи родителем, отмена с условиями, возврат администратором, замена участника.
-- Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (28-33).
--  * журнал событий участника теперь пишет и смену суммы или тарифа (раньше только статус и сбор), плюс текст действующего периода
--    условий отмены на дату отмены (по Тбилиси) в колонке terms_text;
--  * camp_terms_for(сбор, дата): последняя версия условий и её период на дату (внутренняя функция);
--  * camp_parent_update: родитель (или владелец гостевой записи) меняет тариф и комментарий своей записи; тариф только до срока
--    полной оплаты включительно (по Тбилиси), при пустом сроке или нестандартной сумме запрещено; сумма не ниже оплаченной;
--  * camp_parent_cancel: отмена своей записи (статус «cancelled», платежи и история остаются, место освобождается), возвращает
--    внесённую сумму и действующие условия; повторная отмена отклоняется;
--  * camp_refund: возврат администратором строкой refund с минусом (автор ставится сервером), сумма не больше оплаченного;
--    размер возврата система не считает;
--  * camp_participant_replacements и camp_replace_participant: только факт замены (старый, новый, кто, когда), деньги вручную.

alter table camp_participant_events add column if not exists terms_text text;

create or replace function camp_terms_for(cid uuid, d date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v int; per jsonb; t jsonb;
begin
  select version, periods into v, per from camp_cancel_terms where camp_id = cid order by version desc limit 1;
  if v is null then return null; end if;
  select e into t from jsonb_array_elements(per) with ordinality as x(e, ord)
   where (e->>'from' is null or (e->>'from')::date <= d) and (e->>'to' is null or d <= (e->>'to')::date)
   -- пересекающиеся периоды: берётся с самым поздним началом, затем с самым ранним концом, затем первый по порядку в списке
   order by coalesce((e->>'from')::date, date '0001-01-01') desc, coalesce((e->>'to')::date, date '9999-12-31') asc, ord limit 1;
  return jsonb_build_object('version', v, 'text', t->>'text');
end $$;
revoke execute on function camp_terms_for(uuid, date) from public, anon, authenticated;

-- Журнал: событие пишется и при смене суммы или тарифа (статус тот же), при отмене фиксируется период условий
create or replace function camp_participants_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare tf jsonb;
begin
  if tg_op = 'UPDATE' and old.status = new.status and old.camp_id = new.camp_id
     and old.amount is not distinct from new.amount and old.tariff_id is not distinct from new.tariff_id then return null; end if;
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') then
    tf := camp_terms_for(new.camp_id, (now() at time zone 'Asia/Tbilisi')::date);
  end if;
  insert into camp_participant_events (participant_id, camp_id, player_id, from_status, to_status, actor_id, tariff_id, amount, paid, terms_version, terms_text, note)
  values (new.id, new.camp_id, new.player_id, case when tg_op = 'UPDATE' then old.status end, new.status, current_user_id(), new.tariff_id, new.amount,
          (select coalesce(sum(amount), 0) from camp_payments where participant_id = new.id),
          coalesce((tf->>'version')::int, (select max(version) from camp_cancel_terms where camp_id = new.camp_id)),
          tf->>'text',
          coalesce(nullif(current_setting('camp.note', true), ''), 'direct'));
  return null;
end $$;
drop trigger if exists camp_participants_log on camp_participants;
create trigger camp_participants_log after insert or update of status, camp_id, amount, tariff_id on camp_participants
  for each row execute function camp_participants_log();

-- Своя запись: родитель ребёнка (согласие не отозвано) или владелец гостевой записи
create or replace function camp_participant_mine(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from camp_participants cp
                  where cp.id = pid and current_user_id() is not null
                    and (cp.owner_user_id = current_user_id() or (cp.player_id is not null and is_guardian_of(cp.player_id))))
$$;
revoke execute on function camp_participant_mine(uuid) from public, anon, authenticated;

create or replace function camp_parent_update(pid uuid, tid uuid, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; c camps; cm text := nullif(btrim(cmt), ''); tp numeric; cur numeric; paid numeric;
begin
  if not camp_participant_mine(pid) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- порядок блокировок как у остальных функций сборов: сначала сбор, потом участник (иначе взаимная блокировка)
  perform 1 from camps where id = (select camp_id from camp_participants where id = pid) for update;
  select * into cp from camp_participants where id = pid for update;
  select * into c from camps where id = cp.camp_id;
  -- правка, как и запись, только на активном и не закончившемся сборе
  if not c.active or c.ends_on < (now() at time zone 'Asia/Tbilisi')::date then raise exception 'camp closed' using errcode = '22023'; end if;
  if cp.status <> 'registered' then raise exception 'not registered' using errcode = '22023'; end if;
  if length(coalesce(cm, '')) > 500 then raise exception 'bad comment' using errcode = '22023'; end if;
  perform set_config('camp.note', 'parent', true);
  if tid is not null and tid is distinct from cp.tariff_id then
    if c.full_payment_deadline is null or (now() at time zone 'Asia/Tbilisi')::date > c.full_payment_deadline then
      raise exception 'tariff change closed' using errcode = '22023';
    end if;
    select price into cur from camp_tariffs where id = cp.tariff_id;
    if cur is null or cp.amount is distinct from cur then raise exception 'custom amount' using errcode = '22023'; end if;
    select price into tp from camp_tariffs where id = tid and camp_id = cp.camp_id and active;
    if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
    select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = pid;
    if tp < paid then raise exception 'amount below paid' using errcode = '22023'; end if;
    update camp_participants set tariff_id = tid, amount = tp where id = pid;
  end if;
  if cmt is not null then update camp_participants set comment = cm where id = pid; end if;
  perform set_config('camp.note', '', true);
  return pid;
end $$;

create or replace function camp_parent_cancel(pid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; c camps; paid numeric;
begin
  if not camp_participant_mine(pid) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- порядок блокировок как у остальных функций сборов: сначала сбор, потом участник (иначе взаимная блокировка)
  perform 1 from camps where id = (select camp_id from camp_participants where id = pid) for update;
  select * into cp from camp_participants where id = pid for update;
  select * into c from camps where id = cp.camp_id;
  if cp.status = 'cancelled' then raise exception 'already cancelled' using errcode = '23505'; end if;
  if cp.status <> 'registered' then raise exception 'not registered' using errcode = '22023'; end if;
  if c.ends_on < (now() at time zone 'Asia/Tbilisi')::date then raise exception 'camp closed' using errcode = '22023'; end if;
  perform set_config('camp.note', 'parent-cancel', true);
  update camp_participants set status = 'cancelled' where id = pid;
  perform set_config('camp.note', '', true);
  select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = pid;
  return jsonb_build_object('paid', paid, 'terms', camp_terms_for(cp.camp_id, (now() at time zone 'Asia/Tbilisi')::date));
end $$;

-- Возврат: админ (не локальный), запись refund с минусом; размер возврата решает человек
create or replace function camp_refund(pid uuid, amt numeric, d date, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; paid numeric; r uuid;
begin
  perform camp_assert_admin();
  -- порядок блокировок как у остальных функций сборов: сначала сбор, потом участник (иначе взаимная блокировка)
  perform 1 from camps where id = (select camp_id from camp_participants where id = pid) for update;
  select * into cp from camp_participants where id = pid for update;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is not null and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'bad date' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = pid;
  if amt > paid then raise exception 'refund above paid' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, comment)
  values (cp.camp_id, pid, cp.player_id, -amt, coalesce(d, current_date), 'refund', nullif(btrim(cmt), ''))
  returning id into r;
  return r;
end $$;

-- Замена участника: журнал фактов (только добавление)
create table if not exists camp_participant_replacements (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id),
  old_participant_id uuid not null references camp_participants(id),
  new_participant_id uuid not null references camp_participants(id),
  by_user uuid references users(id),
  at timestamptz not null default now(),
  note text check (note is null or length(note) <= 500),
  unique (old_participant_id)
);
drop trigger if exists camp_participant_replacements_no_change on camp_participant_replacements;
drop trigger if exists camp_participant_replacements_no_truncate on camp_participant_replacements;
create trigger camp_participant_replacements_no_change before update or delete on camp_participant_replacements
  for each row execute function camp_events_immutable();
create trigger camp_participant_replacements_no_truncate before truncate on camp_participant_replacements
  for each statement execute function camp_events_immutable();
alter table camp_participant_replacements enable row level security;
revoke all on camp_participant_replacements from public, anon, authenticated, service_role;
grant select on camp_participant_replacements to authenticated;
drop policy if exists camp_participant_replacements_read on camp_participant_replacements;
create policy camp_participant_replacements_read on camp_participant_replacements for select using (is_admin());

create or replace function camp_replace_participant(old_pid uuid, new_pid uuid, nt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o camp_participants; n camp_participants; r uuid; note_t text := nullif(btrim(nt), '');
begin
  perform camp_assert_admin();
  if length(coalesce(note_t, '')) > 500 then raise exception 'bad note' using errcode = '22023'; end if;
  -- сначала блокировка сбора, потом чтение обеих записей: статус не меняется между проверкой и записью
  perform 1 from camps where id = (select camp_id from camp_participants where id = old_pid) for update;
  select * into o from camp_participants where id = old_pid for update;
  select * into n from camp_participants where id = new_pid for update;
  if o.id is null or n.id is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if o.id = n.id or o.camp_id <> n.camp_id or o.status = 'registered' or n.status <> 'registered' then raise exception 'bad replacement' using errcode = '22023'; end if;
  if exists (select 1 from camp_participant_replacements where old_participant_id = old_pid) then raise exception 'already replaced' using errcode = '23505'; end if;
  insert into camp_participant_replacements (camp_id, old_participant_id, new_participant_id, by_user, note)
  values (o.camp_id, old_pid, new_pid, current_user_id(), note_t) returning id into r;
  return r;
end $$;

-- Отмена платежа (0085) и возврат теперь идут по очереди: без блокировки две операции могли увести оплаченное в минус.
-- Права прежние (администратор и локальный администратор своего места), тело то же, добавлены блокировки сбора и участника.
create or replace function camp_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p camp_payments; total numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from camp_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(camp_location(p.camp_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from camps where id = p.camp_id for update;
  perform 1 from camp_participants where id = p.participant_id for update;
  if p.kind = 'refund' or p.amount <= 0 then raise exception 'not cancellable' using errcode = '22023'; end if;
  if exists (select 1 from camp_payments where legacy_ref = 'cancel:' || payid) then raise exception 'already cancelled' using errcode = '23505'; end if;
  select coalesce(sum(amount), 0) into total from camp_payments where participant_id = p.participant_id;
  if total - p.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment, legacy_ref)
  values (p.camp_id, p.participant_id, p.player_id, -p.amount, current_date, 'refund', p.method, 'Отмена платежа', 'cancel:' || payid);
end $$;

revoke execute on function camp_parent_update(uuid, uuid, text), camp_parent_cancel(uuid), camp_refund(uuid, numeric, date, text),
  camp_replace_participant(uuid, uuid, text) from public, anon;
grant execute on function camp_parent_update(uuid, uuid, text), camp_parent_cancel(uuid), camp_refund(uuid, numeric, date, text),
  camp_replace_participant(uuid, uuid, text) to authenticated;
