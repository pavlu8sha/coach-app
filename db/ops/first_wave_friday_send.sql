-- Разовая пятничная рассылка первой волны (миграция 0151). ЗАПУСКАТЬ ТОЛЬКО ПО СЛОВУ ВЛАДЕЛЬЦА.
-- Требует клубную настройку booking.notify = on (db/ops/booking_notify_enable.sql). Сообщения встают в очередь notifications,
-- реально их отправляет tg-notify. Повторный запуск никому не дублирует сообщение. Сначала посмотрите предпросмотр:
--   select * from first_wave_friday(true);   -- только счёт, ничего не отправляется
-- Реальный запуск (от имени администратора, функция проверяет is_admin()):
--   select * from first_wave_friday(false);
-- В SQL Editor нет JWT, поэтому проще нажимать предпросмотр в приложении (Индивидуальные → Первая волна),
-- а реальный запуск выполнять так:
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from users where is_admin order by created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select * from first_wave_friday(false);
commit;
