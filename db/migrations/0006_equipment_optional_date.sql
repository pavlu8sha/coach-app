-- 0006: дата заказа экипировки необязательна — в выгрузке у 110 из 129 заказов даты нет. Черновик 2026-10-22.
alter table equipment_orders alter column ordered_on drop not null;
