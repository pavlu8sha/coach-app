-- 0004: политики доступа для таблиц из 0003. Черновик 2026-10-22.
-- Правила: администратор — всё; тренер группы — свою группу; родитель — своих детей; общие справочники — любому вошедшему.

create or replace function is_coach_of_subscription(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions x where x.id = s and is_coach_of_group(x.group_id))
$$;

-- Общие справочники: цены, каталог экипировки, лагеря, расписание — читают все вошедшие, пишет администратор.
create policy prices_read on prices for select using (auth.uid() is not null);
create policy prices_admin on prices for all using (is_admin()) with check (is_admin());
create policy equipment_catalog_read on equipment_catalog for select using (auth.uid() is not null);
create policy equipment_catalog_admin on equipment_catalog for all using (is_admin()) with check (is_admin());
create policy camps_read on camps for select using (auth.uid() is not null);
create policy camps_admin on camps for all using (is_admin()) with check (is_admin());
create policy weekly_schedule_read on weekly_schedule for select using (auth.uid() is not null);
create policy weekly_schedule_admin on weekly_schedule for all using (is_admin()) with check (is_admin());

-- Абонементы: администратор, тренер группы, родитель ребёнка. Пишет администратор.
create policy subscriptions_read on subscriptions for select
  using (is_admin() or is_coach_of_group(group_id) or is_guardian_of(player_id));
create policy subscriptions_admin on subscriptions for all using (is_admin()) with check (is_admin());

-- Платежи: администратор и родитель ребёнка. Пишет администратор. Тренеры платежей не видят.
create policy payments_read on payments for select
  using (is_admin() or is_guardian_of(player_id));
create policy payments_admin on payments for all using (is_admin()) with check (is_admin());

-- Журнал платежей — только чтение и добавление (как баллы).
revoke update, delete on payments from authenticated;

-- Экипировка: заказы и строки — администратор и родитель ребёнка.
create policy equipment_orders_read on equipment_orders for select
  using (is_admin() or is_guardian_of(player_id));
create policy equipment_orders_admin on equipment_orders for all using (is_admin()) with check (is_admin());
create policy equipment_lines_read on equipment_order_lines for select
  using (is_admin() or exists (select 1 from equipment_orders o where o.id = order_id and is_guardian_of(o.player_id)));
create policy equipment_lines_admin on equipment_order_lines for all using (is_admin()) with check (is_admin());

-- Взносы за матчи: администратор, тренер игрока, родитель ребёнка.
create policy match_fees_read on match_fees for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id));
create policy match_fees_admin on match_fees for all using (is_admin()) with check (is_admin());

-- Участники лагерей: администратор и родитель ребёнка.
create policy camp_participants_read on camp_participants for select
  using (is_admin() or is_guardian_of(player_id));
create policy camp_participants_admin on camp_participants for all using (is_admin()) with check (is_admin());

-- Пробные: только администратор (телефоны — персональные данные).
create policy trials_admin on trials for all using (is_admin()) with check (is_admin());

-- Настройки клуба: только администратор.
create policy club_settings_admin on club_settings for all using (is_admin()) with check (is_admin());
