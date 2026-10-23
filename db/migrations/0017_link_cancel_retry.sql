-- Родитель сам управляет своим запросом на связь с ребёнком:
--  * cancel_link — отменить запрос, пока администратор его не решил (запрос удаляется, ребёнок снова виден в поиске);
--  * retry_link — подать отклонённый запрос снова (статус снова «ждёт подтверждения»).
-- Пишет только функция; прямых прав на запись в link_requests у приложения по-прежнему нет.
-- Подтверждённые связи (player_guardians) эти функции не трогают.

create or replace function cancel_link(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from link_requests where id = r and user_id = current_user_id() and status = 'pending';
  if not found then raise exception 'request not found or already decided'; end if;
end $$;

-- Повторная подача: только свой отклонённый запрос, не чаще раза в сутки после отказа (иначе родитель мог бы
-- бесконечно возвращать запрос администратору), и в пределах общего лимита неподтверждённых запросов.
-- Согласие заново не выдумываем: остаётся то, что родитель дал при подаче; если его версия больше не действует — отказ.
create or replace function retry_link(r uuid) returns void
language plpgsql security definer set search_path = public as $$
declare req link_requests;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into req from link_requests where id = r and user_id = current_user_id() and status = 'rejected';
  if req.id is null then raise exception 'request not found or not rejected'; end if;
  if not exists (select 1 from consent_versions where version = req.consent_version and active) then raise exception 'consent required'; end if;
  if coalesce(req.decided_at, '-infinity') > now() - interval '1 day' then raise exception 'retry too soon'; end if;
  if (select count(*) from link_requests where user_id = current_user_id() and status = 'pending') >= 5 then
    raise exception 'too many pending requests';
  end if;
  update link_requests set status = 'pending', decided_at = null, decided_by = null where id = r;
end $$;

revoke execute on function cancel_link(uuid), retry_link(uuid) from public;
grant execute on function cancel_link(uuid), retry_link(uuid) to authenticated;
