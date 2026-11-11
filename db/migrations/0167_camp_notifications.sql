-- 0167 (Issue #470, этап 4): уведомления по сборам. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (34-36).
-- Сообщения ставятся в общую очередь notifications (enqueue_notification учитывает общий выключатель пользователя),
-- отправляет их Edge Function tg-notify по расписанию. События:
--  * новая запись игрока родителем (camp_signup): администраторам;
--  * новая гостевая заявка (camp_application): администраторам, без данных из заявки;
--  * решение по заявке (camp_application_decision): владельцу заявки;
--  * отмена родителем или владельцем гостевой записи (camp_cancel): администраторам, с названием сбора, именем ребёнка,
--    именем родителя, временем (Тбилиси), внесённой суммой и пометкой про возврат.
-- Администраторы здесь: users.is_admin без локальной роли (location_admins). Записи и правки через админские функции не уведомляют;
-- автор действия своё сообщение не получает.
-- ВАЖНО: пока клубная настройка camps.notify не равна «on», в очередь ничего не ставится (включает владелец отдельным решением,
-- db/ops/camps_notify_enable.sql). Уведомления о документах добавит этап 5.

create or replace function camp_notify_enabled(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lower(trim(value)) in ('on', 'true', '1', 'да') from club_settings where club_id = c and key = 'camps.notify' and scope = '' limit 1), false)
$$;

-- Администраторам без локальной роли; автор действия своё сообщение не получает
create or replace function camp_enqueue_admins(k text, t text, skip uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  for a in select u.id from users u where u.is_admin and u.id is distinct from skip
                and not exists (select 1 from location_admins la where la.user_id = u.id) loop
    perform enqueue_notification(a, k, t);
  end loop;
end $$;

-- Имя для сообщения: его мог ввести посторонний (гостевая заявка, имя в Telegram). Убираем дату рождения, добавленную тёзке,
-- и символы, из которых Telegram делает ссылки и упоминания (точка, косая черта, двоеточие, собака).
create or replace function camp_notify_name(t text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(btrim(regexp_replace(translate(regexp_replace(coalesce(t, ''), ' \(\d\d\.\d\d\.\d{4}\)$', ''), './:@\', '     '), '\s+', ' ', 'g')), ''), '—')
$$;

-- Запись и отмена: по событию журнала участника (журнал пишет триггер camp_participants_log).
-- Ошибка уведомления не отменяет действие пользователя. На одну запись не больше трёх сообщений каждого вида за сутки
-- (цикл «отмена, запись» не заваливает администраторов).
create or replace function camp_notify_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare c camps; child text; who text;
begin
  if new.note not in ('parent', 'parent-cancel') then return null; end if;
  begin
    select * into c from camps where id = new.camp_id;
    if not camp_notify_enabled(c.club_id) then return null; end if;
    if (select count(*) from camp_participant_events e where e.participant_id = new.participant_id and e.note = new.note
          and e.to_status = new.to_status and e.from_status is distinct from e.to_status and e.at > new.at - interval '1 day') > 3 then
      return null;
    end if;
    select camp_notify_name(coalesce(pl.full_name, cp.guest_name)) into child
      from camp_participants cp left join players pl on pl.id = cp.player_id where cp.id = new.participant_id;
    select camp_notify_name(display_name) into who from users where id = new.actor_id;
    if new.note = 'parent' and new.to_status = 'registered' and new.from_status is distinct from 'registered' then
      perform camp_enqueue_admins('camp_signup', 'Новая запись на сбор «' || c.name || '»: ' || coalesce(child, '—') || E'.\nЗаписал родитель: ' || coalesce(who, '—')
        || E'.\nОткройте приложение, раздел «Сборы».', new.actor_id);
    elsif new.note = 'parent-cancel' and new.to_status = 'cancelled' then
      perform camp_enqueue_admins('camp_cancel', 'Отмена записи на сбор «' || c.name || '»: ' || coalesce(child, '—') || E'.\nОтменил: ' || coalesce(who, '—')
        || ', ' || to_char(new.at at time zone 'Asia/Tbilisi', 'DD.MM.YYYY HH24:MI')
        || E'.\nВнесено: ' || trim(to_char(coalesce(new.paid, 0), 'FM999999990.00')) || ' ₾'
        || case when coalesce(new.paid, 0) > 0 then E'.\nНужно определить возврат по условиям отмены.' else E'.\nПлатежей нет, возврат не требуется.' end, new.actor_id);
    end if;
  exception when others then
    raise warning 'camp_notify_event: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists camp_participant_events_notify on camp_participant_events;
create trigger camp_participant_events_notify after insert on camp_participant_events
  for each row execute function camp_notify_event();

-- Гостевая заявка и решение по ней. В сообщение администраторам данные из заявки не попадают (их вводит посторонний);
-- при потоке заявок (больше 20 за час на сбор) новые сообщения не ставятся, заявки видны в приложении.
create or replace function camp_notify_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare c camps;
begin
  begin
    select * into c from camps where id = new.camp_id;
    if not camp_notify_enabled(c.club_id) then return null; end if;
    if tg_op = 'INSERT' and new.status = 'new' then
      if (select count(*) from camp_applications where camp_id = new.camp_id and created_at > now() - interval '1 hour') > 20 then return null; end if;
      perform camp_enqueue_admins('camp_application', 'Новая гостевая заявка на сбор «' || c.name || E'».\nОткройте приложение, раздел «Сборы», заявки.');
    elsif tg_op = 'UPDATE' and old.status = 'new' and new.status in ('approved', 'rejected') then
      perform enqueue_notification(new.owner_user_id, 'camp_application_decision',
        'Заявка на сбор «' || c.name || '» (' || new.child_name || ') ' || case when new.status = 'approved' then 'подтверждена' else 'отклонена' end || '.'
        || coalesce(E'\nКомментарий: ' || new.decision_note, '')
        || case when new.status = 'approved' then E'\nЗапись и оплата видны в приложении.' else '' end);
    end if;
  exception when others then
    raise warning 'camp_notify_application: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists camp_applications_notify on camp_applications;
create trigger camp_applications_notify after insert or update of status on camp_applications
  for each row execute function camp_notify_application();

drop function if exists camp_enqueue_admins(text, text);
revoke execute on function camp_notify_enabled(uuid), camp_enqueue_admins(text, text, uuid), camp_notify_name(text), camp_notify_event(), camp_notify_application() from public, anon, authenticated;
