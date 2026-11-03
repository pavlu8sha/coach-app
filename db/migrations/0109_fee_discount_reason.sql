-- 0109 (#422): скидка на взнос за событие (сбор, турнир) и за матч сохраняет прежнюю сумму, причину, автора и дату.
-- Продолжение #260 (0100: у абонементов закрытие без оплаты требует вид и причину).
-- Деньги, оплаты и флаг paid не меняются: скидка по-прежнему только новая сумма к оплате. Рядом пишется строка журнала.
-- Журнал только дописывается: прямой записи нет, строки создают функции event_discount и match_discount.
-- Старые скидки (до 0109) в журнале не восстанавливаются: прежней суммы и причины в данных нет.
--
-- Порядок применения: миграцию применять перед выкладкой веб-версии с окном причины (#422) или сразу после неё.
-- Окно между ними: старая веб-версия вызывает функции без причины и получает «discount needs reason»,
-- новая веб-версия на старой базе получает «Could not find the function». Оба сбоя безопасны: сумма не меняется.

create table if not exists fee_discount_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('event', 'match')),
  ref_id uuid not null,                  -- tournaments.id или matches.id
  player_id uuid not null references players(id) on delete cascade,
  old_amount numeric(10,2) not null,
  new_amount numeric(10,2) not null,
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists fee_discount_log_ref_idx on fee_discount_log (kind, ref_id, player_id, created_at desc);

alter table fee_discount_log enable row level security;
drop policy if exists fee_discount_log_admin on fee_discount_log;
create policy fee_discount_log_admin on fee_discount_log for select using (is_admin());
revoke all on fee_discount_log from anon, authenticated;
grant select on fee_discount_log to authenticated;
grant all on fee_discount_log to service_role;

-- Старые функции без причины убираем: иначе вызов без причины мог бы обойти обязательность.
drop function if exists event_discount(uuid, uuid, numeric);
drop function if exists match_discount(uuid, uuid, numeric);

create or replace function event_discount(t uuid, pid uuid, due numeric, why text) returns void
language plpgsql security definer set search_path = public as $$
declare old_due numeric;
begin
  perform event_assert_admin();
  if due is null or due < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if length(trim(coalesce(why, ''))) < 3 then raise exception 'discount needs reason' using errcode = '22023'; end if;
  select amount into old_due from tournament_fees where tournament_id = t and player_id = pid;
  if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
  if old_due = due then return; end if;
  update tournament_fees set amount = due where tournament_id = t and player_id = pid;
  insert into fee_discount_log (kind, ref_id, player_id, old_amount, new_amount, reason, created_by)
    values ('event', t, pid, old_due, due, trim(why), current_user_id());
  perform event_fee_recalc(t, pid);
end $$;

create or replace function match_discount(m uuid, pid uuid, due numeric, why text) returns void
language plpgsql security definer set search_path = public as $$
declare old_due numeric;
begin
  perform event_assert_admin();
  if due is null or due < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if length(trim(coalesce(why, ''))) < 3 then raise exception 'discount needs reason' using errcode = '22023'; end if;
  select amount into old_due from match_fees where match_id = m and player_id = pid;
  if not found then raise exception 'player not in match fees' using errcode = 'P0002'; end if;
  if old_due = due then return; end if;
  update match_fees set amount = due where match_id = m and player_id = pid;
  insert into fee_discount_log (kind, ref_id, player_id, old_amount, new_amount, reason, created_by)
    values ('match', m, pid, old_due, due, trim(why), current_user_id());
  perform match_fee_recalc(m, pid);
end $$;

-- Последнее изменение суммы по каждому игроку события или матча (для экрана взносов). Только администратор.
create or replace function fee_discounts(k text, ref uuid)
returns table (player_id uuid, old_amount numeric, new_amount numeric, reason text, by_name text, at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if k not in ('event', 'match') then raise exception 'bad kind' using errcode = '22023'; end if;
  return query
    select distinct on (l.player_id) l.player_id, l.old_amount, l.new_amount, l.reason, u.display_name, l.created_at
      from fee_discount_log l left join users u on u.id = l.created_by
     where l.kind = k and l.ref_id = ref
     order by l.player_id, l.created_at desc;
end $$;

revoke execute on function event_discount(uuid, uuid, numeric, text) from public, anon;
revoke execute on function match_discount(uuid, uuid, numeric, text) from public, anon;
revoke execute on function fee_discounts(text, uuid) from public, anon;
grant execute on function event_discount(uuid, uuid, numeric, text) to authenticated;
grant execute on function match_discount(uuid, uuid, numeric, text) to authenticated;
grant execute on function fee_discounts(text, uuid) to authenticated;
