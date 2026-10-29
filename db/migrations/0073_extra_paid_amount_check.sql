-- 0073 (R-07): extra_set_paid принимал отрицательную сумму (paid_amount = -5). Теперь при оплате amt < 0 отклоняется (22023).
-- Пустая сумма (цена тренировки), нулевая сумма и отмена оплаты работают как в 0035.
create or replace function extra_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses_amt numeric;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select amount into ses_amt from extra_sessions where id = s;
  if is_paid then
    if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
    update extra_bookings set paid = true, paid_amount = coalesce(amt, ses_amt), method = nullif(trim(mth), '') where session_id = s and player_id = p;
  else
    update extra_bookings set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
  end if;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;
