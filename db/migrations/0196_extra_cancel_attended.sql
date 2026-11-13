-- 0196: отмена дополнительной тренировки клубом после отметки посещения (#630, решение владельца 13.11.2026, вариант A).
-- Условия: docs/acceptance/extra-cancel-attended-630-2026-11-13.md. Меняется только тело extra_cancel_session (create or replace);
-- таблицы, права, баллы, серии и финансовая семантика не меняются.
--  * Если у любой записи attended = true, отмена отклоняется ('attendance marked', 22023, как у родителя): сначала снять отметку.
--    Записи сессии блокируются до проверки, поэтому гонка с extra_set_attended не оставит отменённую сессию с отметкой «был».
--  * Запись с attended = false не блокирует отмену: уходит в booking_cancellations (оплаченная 'awaiting', иначе 'cancelled') и удаляется.
--    Раньше такие записи (в том числе оплаченные) оставались без строки журнала.
--  * Уведомление получают семьи всех перенесённых в журнал записей.
-- Rollback: вернуть тело из 0148 (extra_cancel_session, строки 322-343) тем же create or replace; revoke/grant те же.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create or replace function extra_cancel_session(s uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int; lbl text; pls uuid[];
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  -- блокируем записи сессии: параллельная extra_set_attended дождётся нас и увидит, что записи удалены
  perform 1 from extra_bookings where session_id = s for update;
  if exists (select 1 from extra_bookings where session_id = s and attended is true) then
    raise exception 'attendance marked' using errcode = '22023';
  end if;
  lbl := booking_session_label('extra', s);
  pls := array(select player_id from extra_bookings where session_id = s);
  update extra_sessions set cancelled_at = clock_timestamp(), cancelled_by = current_user_id(), cancel_reason = nullif(trim(p_reason), '') where id = s;
  insert into booking_cancellations (club_id, kind, session_id, player_id, starts_at, label, amount, status, cancelled_by)
    select ses.club_id, 'extra', s, b.player_id, ses.starts_on::timestamp + coalesce(ses.starts_time, time '00:00'), ses.place,
           case when b.paid then coalesce(b.paid_amount, ses.amount) else 0 end, case when b.paid then 'awaiting' else 'cancelled' end, current_user_id()
      from extra_bookings b where b.session_id = s;
  get diagnostics n = row_count;
  delete from extra_bookings where session_id = s;
  perform booking_family_notice(ses.club_id, null, 'booking_cancelled', null, pls, 'Тренировка отменена: ' || lbl || coalesce('. Причина: ' || nullif(trim(p_reason), ''), '') || '. Записан(ы): ', '. Оплата, если была, сохранена: администратор свяжется с вами.');
  perform extra_log(s, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'bookings', n));
end $$;
revoke execute on function extra_cancel_session(uuid, text) from public, anon;
grant execute on function extra_cancel_session(uuid, text) to authenticated;

commit;
