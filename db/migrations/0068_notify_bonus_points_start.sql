-- R-16: уведомление «bonus» родителю не создаётся для баллов раньше даты старта (points_start), потому что такие баллы
-- скрыты в приложении. Баллы после старта уведомляются как прежде. Остальное тело функции без изменений (см. 0031).
create or replace function notify_bonus() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text;
begin
  if new.source_type = 'coach' and new.points > 0 and new.occurred_on >= coalesce(points_start(), '-infinity'::date) then
    select full_name into child from players where id = new.player_id;
    perform enqueue_to_guardians(new.player_id, 'bonus', coalesce(child, 'Ребёнок') || ': +' || new.points || ' — ' || coalesce(new.explanation, 'баллы от тренера'));
  end if;
  return null;
end $$;
