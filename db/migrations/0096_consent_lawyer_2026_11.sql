-- 0096 (#230): версия согласия lawyer-2026-11-v1 (текст правил обработки ПДн от юриста клуба, web/src/lib/consent.ts).
-- Без этой строки база отклоняет запрос на привязку ребёнка ('consent required').
-- coach_contacts = true: Telegram родителя виден тренерам группы ребёнка через group_parents (решение Павла 2026-11-02).
-- Прежние версии не отключаются: приложение, открытое до обновления, продолжает работать.

insert into consent_versions (version, coach_contacts) values ('lawyer-2026-11-v1', true) on conflict (version) do nothing;
