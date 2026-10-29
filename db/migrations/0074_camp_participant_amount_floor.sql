-- 0074 (R-09): camp_update_participant позволял сумме участника стать ниже уже оплаченного (оплачено 100, сумма 50).
-- Теперь amt < оплаченного (сумма camp_payments участника) отклоняется (22023, 'amount below paid'). Остальное — как в 0037.
create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform camp_assert_admin();
  select camp_id into cid from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if st not in ('registered', 'declined') then raise exception 'bad status' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < (select coalesce(sum(amount), 0) from camp_payments where participant_id = pid) then raise exception 'amount below paid' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
end $$;
