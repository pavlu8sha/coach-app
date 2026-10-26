-- Тип занятия (индивидуальное / вратарское) можно менять после создания: раньше он выбирался только при создании (0034).
-- ind_edit_session получает пятый параметр gk: null — не менять (прежние вызовы с четырьмя параметрами работают), true/false — задать тип.
-- Внешний ключ занятия пересчитывается (суффикс -GK), занятие того же типа в то же время уже есть — отказ; при смене типа проверяется лимит мест нового типа.
drop function if exists ind_edit_session(uuid, date, time, text);
create or replace function ind_edit_session(s uuid, d date, t time, theme text, gk boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text; new_gk boolean; cap int; n int;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  new_gk := coalesce(gk, ses.goalkeepers);
  if exists (select 1 from individual_bookings where session_id = s and paid) and (d + t) <> ses.starts_at then raise exception 'session has payments' using errcode = '22023'; end if;
  if new_gk <> ses.goalkeepers then
    cap := ind_cap(ses.club_id, new_gk);
    select count(*) into n from individual_bookings where session_id = s;
    if cap is not null and n > cap then raise exception 'session full' using errcode = '22023'; end if;
  end if;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when new_gk then '-GK' else '' end;
  if ext <> ses.external_id and exists (select 1 from individual_sessions where club_id = ses.club_id and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), ''), goalkeepers = new_gk where id = s;
end $$;
revoke execute on function ind_edit_session(uuid, date, time, text, boolean) from public, anon;
grant execute on function ind_edit_session(uuid, date, time, text, boolean) to authenticated;
