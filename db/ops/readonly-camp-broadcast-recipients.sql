-- Только чтение. Показывает, сколько человек получит информационную рассылку по сбору (Issue #470, этап 6, миграция 0170)
-- до включения camps.notify. Число считает тот же отбор, что и отправка: родители активных игроков клуба с действующим
-- согласием и включёнными уведомлениями.
select c.name as club, count(distinct g.user_id) as parents_for_info_broadcast
  from clubs c
  join players p on p.club_id = c.id and p.status = 'active'
  join player_guardians g on g.player_id = p.id and g.consent_revoked_at is null
  join users u on u.id = g.user_id and u.notifications_enabled
 group by c.name;
