-- pgTAP: настройки уведомлений по направлениям (0144, #274): значения по умолчанию, приоритет общего выключателя, доступ.
begin;
create extension if not exists pgtap;
select plan(11);

insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 6101, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 6102, 'Родитель 2', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select string_agg(direction || '=' || enabled, ',') from notify_prefs_get()), 'ind_sat=false,ind_sun=false,goalkeeper=false,extra=true',
  'по умолчанию включены только дополнительные');
select notify_pref_set('ind_sat', true);
select notify_pref_set('extra', false);
select is((select string_agg(direction || '=' || enabled, ',') from notify_prefs_get()), 'ind_sat=true,ind_sun=false,goalkeeper=false,extra=false',
  'настройки направлений независимы и сохраняются');
select notify_pref_set('ind_sat', false);
select notify_pref_set('ind_sat', true);
select is((select count(*)::int from notify_prefs_get() where direction = 'ind_sat' and enabled), 1, 'повторная запись той же настройки безопасна');
select throws_ok($$select notify_pref_set('wrong', true)$$, '22023', 'bad direction', 'неизвестное направление отклоняется');
select throws_ok($$select * from notification_prefs$$, '42501', null, 'таблицу настроек из приложения не читать');
select throws_ok($$select notify_direction_enabled('00000000-0000-0000-0000-0000000000b1', 'extra')$$, '42501', null, 'проверка направления из приложения недоступна');
select throws_ok($$select enqueue_direction_notification('00000000-0000-0000-0000-0000000000b1', 'ind_sat', 'x', 'спам')$$, '42501', null, 'рассылку по направлению из приложения не запустить');

-- рассылка: направление включено → в очередь; выключено → нет; общий выключатель блокирует всё
reset role;
select enqueue_direction_notification('00000000-0000-0000-0000-0000000000b1', 'ind_sat', 'info', 'суббота');
select enqueue_direction_notification('00000000-0000-0000-0000-0000000000b1', 'extra', 'info', 'дополнительная');
select is((select string_agg(text, ',') from notifications where user_id = '00000000-0000-0000-0000-0000000000b1'), 'суббота',
  'в очередь попало только включённое направление');
select enqueue_direction_notification('00000000-0000-0000-0000-0000000000b2', 'extra', 'info', 'доп. по умолчанию');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'дополнительные по умолчанию доходят');
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b1';
select enqueue_direction_notification('00000000-0000-0000-0000-0000000000b1', 'ind_sat', 'info', 'при выключенном общем');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'общий выключатель приоритетнее настройки направления');
select is(notify_direction_enabled('00000000-0000-0000-0000-0000000000b1', 'ind_sat'), false, 'при выключенном общем направление считается выключенным');

select * from finish();
rollback;
