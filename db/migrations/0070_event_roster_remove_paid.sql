-- 0070 (D-03): event_roster_remove снова отказывает, если взнос оплачен флагом (импорт: paid = true без строк оплат).
-- 0053 заменила проверку 0051 (tournament_fees.paid) проверкой tournament_payments; нужны обе.
create or replace function event_roster_remove(t uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_staff();
  if exists (select 1 from tournament_fees where tournament_id = t and player_id = pid and paid)
     or exists (select 1 from tournament_payments where tournament_id = t and player_id = pid) then
    raise exception 'fee already paid';
  end if;
  delete from tournament_fees where tournament_id = t and player_id = pid;
end $$;
