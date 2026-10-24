-- Триггерная функция notify_data_request (0026) создавалась внутри do-блока уже после отзыва прав,
-- поэтому оставалась доступной ролям anon и authenticated. Напрямую её вызвать нельзя (ошибка
-- «trigger functions can only be called as triggers»), но служебным функциям это доступно ни к чему.
do $$ begin
  if to_regprocedure('public.notify_data_request()') is not null then
    execute 'revoke execute on function public.notify_data_request() from public, anon, authenticated';
  end if;
end $$;
