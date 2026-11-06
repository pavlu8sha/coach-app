-- Включение уведомлений о записи на тренировки (Issue #274, PR 5, миграция 0148). НЕ ЗАПУСКАТЬ без отдельного слова владельца:
-- после запуска события (автозапись постоянным по вторникам, подтверждения записи, изменение и отмена занятий,
-- приглашения на дополнительные) начнут ставить сообщения в очередь, а tg-notify отправит их родителям.
-- Выключить обратно: значение 'off'.
update club_settings set value = 'on' where key = 'booking.notify';
insert into club_settings (club_id, key, value, scope)
select c.id, 'booking.notify', 'on', '' from clubs c
 where not exists (select 1 from club_settings s where s.club_id = c.id and s.key = 'booking.notify');
