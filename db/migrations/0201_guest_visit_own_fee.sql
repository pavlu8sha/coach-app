-- 0201: игрок «Платит за визит» на тренировке чужой группы платит 20 ₾ (own_visit.fee), а не 15. Условия: docs/PAY_PER_VISIT_GUEST_ACCEPTANCE.md.
-- Решение владельца 2026-11-16 (Fedorov Lev, Fedorov Matvey пришли 15.11 на чужую группу). Меняется только цена, фиксируемая в session_guests.amount
-- при добавлении гостя: проверки, баллы, оплата, права и остальное из 0178 без изменений. Уже созданные строки не меняются (их правит db/ops/guest-visit-fedorov-20-2026-11-16.sql).
-- Тело session_guest_add взято из 0178 (последнее определение; проверено grep -E "function +(public\.)?session_guest_add" по db/migrations). Требует 0178 и 0200.
-- Откат: db/ops/rollback-0201-guest-visit-own-fee.sql (возвращает тело из 0178). Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create or replace function session_guest_add(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses sessions; pl players; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select * into pl from players where id = p;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  select g.club_id into club from groups g where g.id = ses.group_id;
  if pl.club_id is distinct from club then raise exception 'player not found' using errcode = 'P0002'; end if;
  if tbilisi_day(ses.starts_at) > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.group_id is not distinct from ses.group_id then raise exception 'same group' using errcode = '22023'; end if;
  if pl.status <> 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  -- 0201: игрок «Платит за визит» (на день занятия) платит за гостевое посещение own_visit.fee (20), остальные visit.fee (15)
  insert into session_guests (session_id, player_id, amount, added_by)
    values (s, p,
            case when pl.pay_mode = 'per_visit' and pl.pay_mode_from is not null and pl.pay_mode_from <= tbilisi_day(ses.starts_at)
                 then own_visit_fee(club) else guest_visit_fee(club) end,
            current_user_id())
    on conflict (session_id, player_id) do nothing;
end $$;

commit;
