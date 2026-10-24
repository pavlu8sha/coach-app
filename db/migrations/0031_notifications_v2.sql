-- Уведомления, часть 2 (см. docs/NOTIFICATIONS.md): тренеру — о назначении группы;
-- родителю — о принятой оплате и о ручных баллах ребёнку. Получатель и так видит эти данные в приложении.
-- Родителям пишем только при действующем согласии (consent_revoked_at is null).

create or replace function enqueue_to_guardians(p uuid, k text, t text) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  for g in select user_id from player_guardians where player_id = p and consent_revoked_at is null loop
    perform enqueue_notification(g, k, t);
  end loop;
end $$;

-- Тренеру: назначена группа
create or replace function notify_coach_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare grp text;
begin
  select name into grp from groups where id = new.group_id;
  perform enqueue_notification(new.user_id, 'coach_assigned', 'Вам назначена группа ' || coalesce(grp, '—') || E'.\nОткройте приложение: вкладки «Занятия», «Матчи» и «Группа».');
  return null;
end $$;
create trigger coach_groups_notify after insert on coach_groups
  for each row execute function notify_coach_group();

-- Родителю: оплата принята (сумма с минусом — исправление, о нём не пишем)
create or replace function notify_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text;
begin
  if new.amount > 0 then
    select full_name into child from players where id = new.player_id;
    perform enqueue_to_guardians(new.player_id, 'payment', 'Получена оплата ' || trim(trailing '.' from trim(trailing '0' from new.amount::text)) || ' ₾ за ' || coalesce(child, 'ребёнка') || '. Спасибо!');
  end if;
  return null;
end $$;
create trigger payments_notify after insert on payments
  for each row execute function notify_payment();

-- Родителю: ручные баллы от тренера
create or replace function notify_bonus() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text;
begin
  if new.source_type = 'coach' and new.points > 0 then
    select full_name into child from players where id = new.player_id;
    perform enqueue_to_guardians(new.player_id, 'bonus', coalesce(child, 'Ребёнок') || ': +' || new.points || ' — ' || coalesce(new.explanation, 'баллы от тренера'));
  end if;
  return null;
end $$;
create trigger point_events_notify after insert on point_events
  for each row execute function notify_bonus();

revoke execute on function enqueue_to_guardians(uuid, text, text), notify_coach_group(), notify_payment(), notify_bonus()
  from public, anon, authenticated;
