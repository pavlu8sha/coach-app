-- Автонапоминания RSVP: окно «за 24 часа» было 15 минут шириной (срок ответа = старт − 24 ч), а запуск раз в 10 минут,
-- поэтому один пропущенный запуск лишал родителя напоминания. Теперь вид auto_24h начинается за 25 часов до матча
-- (остаётся 1 час запаса до закрытия приёма ответов). Пауза после публикации или переноса сокращена с 12 до 3 часов,
-- чтобы матч, объявленный менее чем за 60 часов, всё равно получал напоминание за 48 часов.
-- Лимит «одно напоминание родителю за 24 часа» и уникальность по виду проверяет rsvp_claim_reminder (не менялась).
create or replace function rsvp_auto_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; q int := 0; k text;
begin
  for r in
    select mt.id as m, g.user_id as u, mt.starts_at
      from matches mt
      join match_invitations i on i.match_id = mt.id and i.status = 'invited' and i.response is null
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()
       and clock_timestamp() >= mt.starts_at - interval '48 hours'
       and clock_timestamp() <= coalesce(i.answer_until, mt.starts_at)
       and greatest(coalesce(mt.published_at, '-infinity'), coalesce(mt.rescheduled_at, '-infinity')) < clock_timestamp() - interval '3 hours'
     group by mt.id, g.user_id, mt.starts_at
     order by mt.starts_at, g.user_id
  loop
    k := case when clock_timestamp() >= r.starts_at - interval '25 hours' then 'auto_24h' else 'auto_48h' end;
    if rsvp_claim_reminder(r.m, r.u, k, null) then q := q + 1; end if;
  end loop;
  return q;
end $$;
revoke execute on function rsvp_auto_reminders() from public, anon, authenticated;
grant execute on function rsvp_auto_reminders() to service_role;
